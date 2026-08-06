import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { gatherLeads } from './sources/index.js';
import { runPipeline } from './pipeline/runPipeline.js';
import { dedupeKey } from './lib/normalizeUrl.js';
import { scoreLeads } from './quality/scorer.js';
import { filterByScore } from './quality/qualityFilter.js';
import { syncLeadsToSupabase, fetchMasterFromSupabase } from './lib/pushToSupabase.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { CSV_COLUMNS } from './lib/leadFields.js';
import { scrapeUrl } from './commands/scrapeUrl.js';
import { scrapeFirms } from './commands/scrapeFirms.js';
import { runSavedSearches } from './personalized/runSavedSearches.js';
import { runLlmClassification } from './jobs/runLlmClassification.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'config.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve a working Python 3 executable. On Windows `python3` is usually just
// the Microsoft Store stub (not real Python), so we probe candidates and pick
// the first that actually reports Python 3. Override with PYTHON_BIN in .env.
function resolvePythonBin() {
  const candidates = process.env.PYTHON_BIN
    ? [process.env.PYTHON_BIN]
    : process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test((r.stdout || '') + (r.stderr || ''))) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}
const PYTHON_BIN = resolvePythonBin();

function csvCell(value) {
  const s = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(records) {
  const header = CSV_COLUMNS.map(([, title]) => title).join(',');
  const rows = records.map((rec) =>
    CSV_COLUMNS.map(([id]) => csvCell(rec[id])).join(',')
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

function runTimestamp() {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}-${pad(n.getHours())}${pad(n.getMinutes())}`;
}

function loadMasterJson(jsonPath) {
  if (!existsSync(jsonPath)) return [];
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    console.warn('  Warning: could not parse master.json, starting fresh.');
    return [];
  }
}

export function pruneExpired(leads, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const pruned = leads.filter((l) => {
    const seenAt = l.last_seen_at || l.scraped_at;
    if (!seenAt) return true;
    return new Date(seenAt).getTime() > cutoff;
  });
  const dropped = leads.length - pruned.length;
  if (dropped > 0) console.log(`  Pruned ${dropped} leads older than ${days} days from master`);
  return pruned;
}

// Merges freshly-scraped leads into the accumulated master list. A lead
// seen before keeps its original first_seen_at but always advances
// last_seen_at/scraped_at to now — this is what makes pruneExpired() able
// to tell "still being found every run" apart from "hasn't shown up in
// weeks," instead of freezing every lead's timestamp at its first sighting.
export function mergeMaster(existing, newLeads) {
  const byKey = new Map();
  for (const lead of existing) {
    const key = dedupeKey(lead);
    if (key) byKey.set(key, { ...lead });
  }
  const now = new Date().toISOString();
  let added = 0;
  for (const lead of newLeads) {
    const key = dedupeKey(lead);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { ...lead, first_seen_at: lead.first_seen_at || now, last_seen_at: now, scraped_at: now });
      added++;
    } else {
      const base = byKey.get(key);
      for (const [field] of CSV_COLUMNS) {
        if (!base[field] && lead[field]) base[field] = lead[field];
      }
      base.last_seen_at = now;
      base.scraped_at = now;
    }
  }
  console.log(`  +${added} new leads added to master (${byKey.size} total unique)`);
  return [...byKey.values()];
}

// OneDrive can hold a sync lock on the target for several seconds (EBUSY).
// Retry with backoff; if it stays locked, fall back to a timestamped filename
// so the run's data is never lost.
async function writeCsv(records, outPath, attempts = 8) {
  const content = toCsv(records);
  for (let i = 1; i <= attempts; i++) {
    try {
      writeFileSync(outPath, content, 'utf8');
      return outPath;
    } catch (err) {
      if (err.code === 'EBUSY' && i < attempts) {
        console.warn(`  file locked (OneDrive/AV), retry ${i}/${attempts - 1}...`);
        await sleep(Math.min(1000 * i, 4000));
        continue;
      }
      if (err.code === 'EBUSY') {
        // Give up on the locked name; write to a fresh one instead.
        const fallback = outPath.replace(/\.csv$/i, `-${Date.now()}.csv`);
        writeFileSync(fallback, content, 'utf8');
        console.warn(`  target was locked; wrote to ${fallback} instead.`);
        return fallback;
      }
      throw err;
    }
  }
}

async function main() {
  console.log('Lead scraper starting\n');
  const cloak = config.cloak || {};

  let allLeads = await gatherLeads(config, cloak, { pythonBin: PYTHON_BIN });

  allLeads = await runPipeline(allLeads, { config, pythonBin: PYTHON_BIN });

  const minScore = config.quality?.minScore ?? 35;

  // --- Per-run file ---
  const label = config.runLabel ? `-${config.runLabel}` : '';
  const runFile = resolve(root, `output/runs/leads-${runTimestamp()}${label}.csv`);
  mkdirSync(dirname(runFile), { recursive: true });
  const runWritten = await writeCsv(allLeads, runFile);
  console.log(`\nRun file:    ${allLeads.length} leads → ${runWritten}`);

  // --- Master file (all runs merged + deduped + re-scored) ---
  // Re-score the ENTIRE master after merge so existing leads always reflect
  // the latest scorer logic and never keep stale/empty scores from old runs.
  const masterJson = resolve(root, 'output/master.json');
  const masterCsv  = resolve(root, 'output/leads-master.csv');
  // Supabase is the source of truth when configured: master.json is
  // gitignored (never persists across CI runs), so reading it here would
  // silently start every run from an empty list. Falls back to the local
  // file only for offline/no-.env dev runs.
  const existing = getSupabaseClient()
    ? pruneExpired(await fetchMasterFromSupabase(), 30)
    : pruneExpired(loadMasterJson(masterJson), 30);
  const merged     = mergeMaster(existing, allLeads);
  console.log('Re-scoring master...');
  scoreLeads(merged);
  const masterFiltered = filterByScore(merged, minScore);
  if (masterFiltered.length < merged.length)
    console.log(`  Pruned ${merged.length - masterFiltered.length} Tier D records from master.`);
  masterFiltered.sort((a, b) => (b.score || 0) - (a.score || 0));
  writeFileSync(masterJson, JSON.stringify(masterFiltered, null, 2), 'utf8');
  const masterWritten = await writeCsv(masterFiltered, masterCsv);
  console.log(`Master file: ${masterFiltered.length} total leads → ${masterWritten}`);

  // --- Sync full deduped master to Supabase (frontend reads from here) ---
  console.log('Syncing leads to Supabase...');
  await syncLeadsToSupabase(masterFiltered);
}

// Phase 2 on-demand entrypoints: `node src/index.js url <website>` and
// `node src/index.js firms <file>` (one firm name per line). Both route
// through the same runPipeline the weekly scrape uses and write a CSV under
// output/on-demand/ instead of touching the accumulated master.
async function runUrlCommand(website) {
  const lead = await scrapeUrl(website, { config, pythonBin: PYTHON_BIN });
  if (!lead) {
    console.log('No lead produced (filtered out or no usable contact info).');
    return;
  }
  const outFile = resolve(root, `output/on-demand/url-${runTimestamp()}.csv`);
  mkdirSync(dirname(outFile), { recursive: true });
  await writeCsv([lead], outFile);
  console.log(`\n${JSON.stringify(lead, null, 2)}\n\nWritten to ${outFile}`);
}

async function runFirmsCommand(firmsFile) {
  const leads = await scrapeFirms(firmsFile, { config, pythonBin: PYTHON_BIN });
  const outFile = resolve(root, `output/on-demand/firms-${runTimestamp()}.csv`);
  mkdirSync(dirname(outFile), { recursive: true });
  const written = await writeCsv(leads, outFile);
  console.log(`\n${leads.length} leads written to ${written}`);
}

// Guard so this module can be imported for unit testing (e.g. mergeMaster,
// pruneExpired in test/mergeMaster.test.js) without kicking off a real scrape.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest[0];
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const run =
    cmd === 'url' && arg
      ? () => runUrlCommand(arg)
      : cmd === 'firms' && arg
        ? () => runFirmsCommand(arg)
        : cmd === 'saved-searches'
          ? () => runSavedSearches({ config, cloak: config.cloak || {}, pythonBin: PYTHON_BIN })
          : cmd === 'classify'
            ? () =>
                runLlmClassification({
                  config: {
                    ...config,
                    llmClassification: {
                      ...(config.llmClassification || {}),
                      ...(flags.has('--dry-run') ? { dryRun: true } : {}),
                      ...(flags.has('--force') ? { forceReclassify: true } : {}),
                    },
                  },
                })
            : main;

  run().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
