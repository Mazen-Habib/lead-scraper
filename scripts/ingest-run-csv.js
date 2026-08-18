// Ingests a CSV of RAW leads (e.g. produced by scrapy-scraper/) through the
// same quality pipeline the weekly scrape uses, then merges into the master
// and syncs to Supabase.
//
// This exists because output/runs/*.csv is WRITE-ONLY as far as the rest of
// the codebase is concerned — src/index.js writes run files there but nothing
// ever reads them back (the master merge sources its "existing" set from
// Supabase, or output/master.json as a dev fallback). scrapy-scraper/README.md
// used to claim the master merge picks these up automatically; it does not,
// and a spider's output would have sat on disk doing nothing. This is the
// missing path.
//
// Why not scripts/backfill-supabase.js? That one is a recovery tool: it
// upserts already-finished leads and only scores rows that have no score. Raw
// spider output has had no ICP filter, no email enrichment, no MX verify, no
// classification — pushing it through backfill would put unqualified,
// unclassified rows straight into the table the dashboard reads.
//
// Usage:
//   node scripts/ingest-run-csv.js output/runs/scrapy-businesslist-<ts>.csv [more.csv ...]
//   node scripts/ingest-run-csv.js --dry-run <csv>    # pipeline only, no writes
import 'dotenv/config';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runPipeline } from '../src/pipeline/runPipeline.js';
// mergeMaster/pruneExpired live in src/index.js, which is safe to import: its
// CLI entry point is guarded behind a `process.argv[1] === this file` check,
// so importing it here does not kick off a scrape.
import { mergeMaster, pruneExpired } from '../src/index.js';
import { fetchMasterFromSupabase, syncLeadsToSupabase } from '../src/lib/pushToSupabase.js';
import { scoreLeads } from '../src/quality/scorer.js';
import { filterByScore } from '../src/quality/qualityFilter.js';
import { CSV_COLUMNS } from '../src/lib/leadFields.js';
import { toCsv } from '../src/lib/csv.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'config.json'), 'utf8'));

// Accepts either convention in the header: internal field ids (`name`, what a
// spider writes) or DB column titles (`company_name`, what our own run files
// use), so a hand-made CSV works either way.
const TITLE_TO_FIELD = new Map(CSV_COLUMNS.map(([field, title]) => [title, field]));
const KNOWN_FIELDS = new Set(CSV_COLUMNS.map(([field]) => field));

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const lead = {};
    headers.forEach((header, i) => {
      const field = KNOWN_FIELDS.has(header) ? header : TITLE_TO_FIELD.get(header);
      if (!field) return;
      const value = values[i] ?? '';
      if (value !== '') lead[field] = value;
    });
    return lead;
  }).filter((l) => l.name);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const paths = args.filter((a) => !a.startsWith('--'));

  if (paths.length === 0) {
    console.error('Usage: node scripts/ingest-run-csv.js <path/to.csv> [more.csv ...] [--dry-run]');
    process.exit(1);
  }

  const raw = [];
  for (const arg of paths) {
    const path = resolve(arg);
    if (!existsSync(path)) {
      console.warn(`  !! not found, skipping: ${path}`);
      continue;
    }
    const leads = parseCsv(readFileSync(path, 'utf8'));
    console.log(`Loaded ${leads.length} raw leads from ${path}`);
    raw.push(...leads);
  }

  if (raw.length === 0) {
    console.error('No parseable leads found — check the CSV header matches src/lib/leadFields.js.');
    process.exit(1);
  }

  console.log(`\n${raw.length} raw leads -> quality pipeline`);
  const processed = await runPipeline(raw, { config });
  console.log(`${processed.length} leads survived the pipeline`);

  if (processed.length === 0) {
    console.log('Nothing survived — not touching the master or Supabase.');
    return;
  }

  if (dryRun) {
    const byIndustry = processed.reduce((acc, l) => {
      const key = l.industry || '(unclassified)';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log('\n--dry-run: no writes. Industry breakdown:');
    Object.entries(byIndustry)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
    return;
  }

  const minScore = config.quality?.minScore ?? 35;
  const masterJson = resolve(root, 'output/master.json');

  const existing = pruneExpired(await fetchMasterFromSupabase(), 30);
  const merged = mergeMaster(existing, processed);
  scoreLeads(merged);
  const final = filterByScore(merged, minScore);
  final.sort((a, b) => (b.score || 0) - (a.score || 0));

  writeFileSync(masterJson, JSON.stringify(final, null, 2), 'utf8');
  writeFileSync(resolve(root, 'output/leads-master.csv'), toCsv(final), 'utf8');
  console.log(`Master: ${final.length} total leads`);

  console.log('Syncing to Supabase...');
  const { failed } = await syncLeadsToSupabase(final);
  if (failed > 0) {
    console.error(`\nFAILED: ${failed} lead(s) did not sync after retries.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
