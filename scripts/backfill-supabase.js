// One-off backfill: merges the local master.json with any lead CSVs passed
// as CLI args (e.g. old runs recovered from another machine, or a master CSV
// whose Supabase sync silently dropped rows — see the batch-failure note on
// syncLeadsToSupabase in src/lib/pushToSupabase.js), and upserts everything
// into Supabase.
//
// Field list is imported from leadFields.js (the single canonical mapping —
// see its own header comment) rather than a second hardcoded copy: this file
// used to keep its own duplicate list that had drifted out of date (missing
// industry/tags/region/tag_source/etc entirely), so a "recovery" run would
// have upserted null over classification data Supabase already had correct.
// Whenever a field is missing here, add it to leadFields.js once, not here.
//
// Parsed rows are dual-keyed: leadFields.js's internal field id (what
// scorer.js/classifier.js/dedupeKey read, e.g. `name`, `reviews`) AND its DB
// column title (what pushToSupabase.js's toRow() reads, e.g. `company_name`,
// `review_count`) both point at the same value, so a row works with either
// convention regardless of which one a given helper expects.
//
// Only leads with no score are re-scored. A CSV produced by the real
// pipeline (runPipeline.js) already carries a correct score/tier from real
// classification and reviews data — recomputing it here from a flattened CSV
// row (using CSV_COLUMNS' string values, no re-classification) would produce
// a worse number, not a corrected one. Re-scoring is for genuinely raw,
// never-scored rows only (e.g. a recovered CSV from an old partial run).
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dedupeKey } from '../src/lib/normalizeUrl.js';
import { scoreLeads } from '../src/quality/scorer.js';
import { syncLeadsToSupabase } from '../src/lib/pushToSupabase.js';
import { CSV_COLUMNS } from '../src/lib/leadFields.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ARRAY_FIELDS = new Set(['tags', 'sub_industries']); // semicolon-joined in the CSV
const BOOL_FIELDS = new Set(['is_enterprise']);

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// title -> internal field id, built from CSV_COLUMNS so a header re-order or
// rename in leadFields.js is picked up automatically rather than needing a
// second edit here.
const TITLE_TO_FIELD = new Map(CSV_COLUMNS.map(([field, title]) => [title, field]));

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const lead = {};
    headers.forEach((title, i) => {
      const field = TITLE_TO_FIELD.get(title.trim());
      if (!field) return;
      let value = values[i] ?? '';
      if (ARRAY_FIELDS.has(field)) {
        value = value ? value.split(';').map((s) => s.trim()).filter(Boolean) : [];
      } else if (BOOL_FIELDS.has(field)) {
        value = value === 'true';
      }
      lead[field] = value; // internal field id (scorer.js/classifier.js/dedupeKey convention)
      if (title !== field) lead[title] = value; // DB column title (toRow() convention)
    });
    return lead;
  });
}

function mergeAll(sets) {
  const byKey = new Map();
  let added = 0;
  for (const leads of sets) {
    for (const lead of leads) {
      const key = dedupeKey(lead);
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, { ...lead });
        added++;
      } else {
        const base = byKey.get(key);
        for (const [field, title] of CSV_COLUMNS) {
          if (!base[field] && lead[field]) { base[field] = lead[field]; if (title !== field) base[title] = lead[field]; }
        }
      }
    }
  }
  return { merged: [...byKey.values()], added };
}

async function main() {
  const sets = [];

  const masterJsonPath = resolve(root, 'output/master.json');
  if (existsSync(masterJsonPath)) {
    const existing = JSON.parse(readFileSync(masterJsonPath, 'utf8'));
    console.log(`Loaded ${existing.length} leads from output/master.json`);
    sets.push(existing);
  }

  for (const arg of process.argv.slice(2)) {
    const path = resolve(arg);
    if (!existsSync(path)) {
      console.warn(`  !! CSV not found, skipping: ${path}`);
      continue;
    }
    const leads = parseCsv(readFileSync(path, 'utf8'));
    console.log(`Loaded ${leads.length} leads from ${path}`);
    sets.push(leads);
  }

  if (sets.length === 0) {
    console.error('Nothing to backfill — no output/master.json and no CSV path given.');
    console.error('Usage: node scripts/backfill-supabase.js <path/to.csv> [more.csv ...]');
    process.exit(1);
  }

  const { merged, added } = mergeAll(sets);
  console.log(`\n${merged.length} unique leads after merge (from ${added} raw rows across ${sets.length} source(s))`);

  const alreadyScored = merged.filter((l) => l.score !== undefined && l.score !== null && l.score !== '');
  const needsScoring = merged.filter((l) => !alreadyScored.includes(l));
  if (needsScoring.length > 0) {
    console.log(`Scoring ${needsScoring.length} lead(s) with no existing score (leaving ${alreadyScored.length} already-scored lead(s) untouched)...`);
    scoreLeads(needsScoring);
  } else {
    console.log(`All ${merged.length} leads already have a score from their original pipeline run — not re-scoring.`);
  }
  merged.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  console.log('\nSyncing to Supabase...');
  const { synced, skipped } = await syncLeadsToSupabase(merged);
  if (skipped) {
    console.error('Supabase not configured — check .env has SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  console.log(`Done: ${synced}/${merged.length} leads synced.`);
  if (synced < merged.length) {
    console.error(`!! ${merged.length - synced} lead(s) did not sync — see the "Supabase upsert failed for batch" lines above for why.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
