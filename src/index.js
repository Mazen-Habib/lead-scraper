import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolvePythonBin } from './lib/pythonBin.js';
import { gatherLeads } from './sources/index.js';
import { runPipeline } from './pipeline/runPipeline.js';
import { dedupeKey } from './lib/normalizeUrl.js';
import { scoreLeads } from './quality/scorer.js';
import { filterByScore } from './quality/qualityFilter.js';
import { syncLeadsToSupabase, fetchMasterFromSupabase } from './lib/pushToSupabase.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { toCsv } from './lib/csv.js';
import { CSV_COLUMNS } from './lib/leadFields.js';
import { scrapeUrl } from './commands/scrapeUrl.js';
import { scrapeFirms } from './commands/scrapeFirms.js';
import { runSavedSearches } from './personalized/runSavedSearches.js';
import { runLlmClassification } from './jobs/runLlmClassification.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'config.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PYTHON_BIN = resolvePythonBin();

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

async function main({ only } = {}) {
  console.log('Lead scraper starting\n' + (only ? `  (scoped to: ${only.join(', ')})\n` : ''));
  const cloak = config.cloak || {};

  let allLeads = await gatherLeads(config, cloak, { pythonBin: PYTHON_BIN, only });

  // Early read of the current master, purely to (a) tell the operator what
  // fraction of this run is genuinely new vs re-scraping known companies, and
  // (b) hand runPipeline a knownByKey map so it can backfill already-known
  // fields and skip redundant enrichment work for duplicates. This is a
  // SEPARATE read from the one below used for the final merge — deliberately
  // not reused, so the final merge still always reads the freshest master
  // right before writing, exactly as it did before this existed. An extra
  // ~14k-row Supabase read is cheap; the enrichment work it lets us skip is
  // not (see scripts/audit-leads.js — measured ~88% of a typical run's
  // scraped leads are already-known duplicates).
  const knownForBackfill = getSupabaseClient()
    ? await fetchMasterFromSupabase()
    : loadMasterJson(resolve(root, 'output/master.json'));
  const knownByKey = new Map();
  for (const lead of knownForBackfill) {
    const key = dedupeKey(lead);
    if (key) knownByKey.set(key, lead);
  }
  const alreadyKnown = allLeads.filter((l) => knownByKey.has(dedupeKey(l))).length;
  console.log(
    `  ${alreadyKnown}/${allLeads.length} scraped leads (${
      allLeads.length ? Math.round((100 * alreadyKnown) / allLeads.length) : 0
    }%) already known — enrichment will be skipped for those with a known email\n`
  );

  allLeads = await runPipeline(allLeads, { config, pythonBin: PYTHON_BIN, knownByKey });

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
  const syncResult = await syncLeadsToSupabase(masterFiltered);
  // No missing leads are tolerated: a partial sync failure (after retries)
  // must fail the run loudly rather than looking like a clean success — the
  // recovery CSV already saved the failed rows (see syncLeadsToSupabase), but
  // someone still needs to notice and run the recovery step.
  if (syncResult.failed > 0) {
    console.error(`\nFAILED: ${syncResult.failed} lead(s) could not be synced to Supabase after retries.`);
    process.exitCode = 1;
  }
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
  const argv = process.argv.slice(2);
  // --only=key1,key2 scopes the default scrape to a subset of SOURCE_REGISTRY
  // keys (gatherLeads already supported this via its `only` option — this is
  // just the first CLI exposure of it), e.g. weekly-scrape-general.yml uses
  // --only=googleMapsGeneral,openStreetMap so the general-vertical run never
  // touches the tech sources' scrape budget.
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').filter(Boolean) : undefined;

  const [cmd, ...rest] = argv.filter((a) => !a.startsWith('--only='));
  const arg = cmd && !cmd.startsWith('--') ? rest[0] : undefined;
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.startsWith('--only=')));
  const isSubcommand = cmd && !cmd.startsWith('--');

  const run =
    isSubcommand && cmd === 'url' && arg
      ? () => runUrlCommand(arg)
      : isSubcommand && cmd === 'firms' && arg
        ? () => runFirmsCommand(arg)
        : isSubcommand && cmd === 'saved-searches'
          ? () => runSavedSearches({ config, cloak: config.cloak || {}, pythonBin: PYTHON_BIN })
          : isSubcommand && cmd === 'classify'
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
            : () => main({ only });

  run().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
