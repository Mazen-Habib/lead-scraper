/**
 * Continuous enrichment worker — the piece of the pipeline that's actually
 * bottlenecked by running only inside a weekly batch window (see memory.md's
 * "Overture category widening + dashboard default" / runtime-scoping entry).
 * Discovery (Google Maps, OSM, businesslist, Overture) stays on the existing
 * weekly cron; this script is meant to run continuously on its own box,
 * working through the backlog of already-scraped leads that have a website
 * but are still missing an email, LinkedIn, or decision-maker name.
 *
 * Deliberately reuses the exact same enrichment building blocks
 * runPipeline.js already uses (enrichLeads, scrapegraph, Firecrawl,
 * verifyLeads, scoreLeads) rather than reimplementing them — this is the
 * same enrichment logic, just running against already-stored Supabase rows
 * in a loop instead of a freshly-scraped batch once a week.
 *
 * Usage:
 *   node scripts/enrichment-worker.js              # run forever
 *   node scripts/enrichment-worker.js --once        # process one batch, exit
 *   node scripts/enrichment-worker.js --batch-size=50
 *
 * Safe to stop (Ctrl+C / SIGTERM) and restart anytime — it always re-queries
 * for outstanding work rather than keeping in-memory state, and every write
 * is a per-lead Supabase update, not a bulk file rewrite.
 */
import 'dotenv/config';
import { spawnSync } from 'child_process';
import { getSupabaseClient } from '../src/lib/supabaseClient.js';
import { resolvePythonBin } from '../src/lib/pythonBin.js';
import { CSV_COLUMNS } from '../src/lib/leadFields.js';
import { cleanLead } from '../src/lib/cleanLead.js';
import { enrichLeads } from '../src/scrapers/emailFinder.js';
import { enrichWithFirecrawl } from '../src/lib/firecrawlEnricher.js';
import { verifyLeads } from '../src/quality/emailVerifier.js';
import { scoreLeads } from '../src/quality/scorer.js';
import config from '../config.json' with { type: 'json' };

const args = process.argv.slice(2);
const RUN_ONCE = args.includes('--once');
const BATCH_SIZE = parseInt((args.find((a) => a.startsWith('--batch-size=')) || '').split('=')[1] || '30', 10);
const IDLE_POLL_MS = 5 * 60 * 1000;   // nothing to do — check again in 5 min
const BATCH_PAUSE_MS = 15 * 1000;      // between batches when there IS work — gentle pacing, not a blast
const RETRY_COOLDOWN_DAYS = 7;         // a failed attempt isn't retried sooner than this

const dbColumns = ['id', ...CSV_COLUMNS.map(([, dbCol]) => dbCol)];
const internalByDb = Object.fromEntries(CSV_COLUMNS.map(([internal, dbCol]) => [dbCol, internal]));
const dbByInternal = Object.fromEntries(CSV_COLUMNS.map(([internal, dbCol]) => [internal, dbCol]));

let shuttingDown = false;
process.on('SIGINT', () => { console.log('\nShutting down after the current batch finishes...'); shuttingDown = true; });
process.on('SIGTERM', () => { console.log('\nShutting down after the current batch finishes...'); shuttingDown = true; });

function rowToLead(row) {
  const lead = { id: row.id };
  for (const [dbCol, val] of Object.entries(row)) {
    if (dbCol === 'id') continue;
    lead[internalByDb[dbCol] ?? dbCol] = val;
  }
  return lead;
}

async function fetchBatch(supabase) {
  const cooldownCutoff = new Date(Date.now() - RETRY_COOLDOWN_DAYS * 86400 * 1000).toISOString();
  const { data, error } = await supabase
    .from('leads')
    .select(dbColumns.join(','))
    .not('website', 'is', null)
    .neq('website', '')
    .or('email.is.null,linkedin.is.null,contact_name.is.null')
    .or(`last_enrichment_attempt_at.is.null,last_enrichment_attempt_at.lt.${cooldownCutoff}`)
    .order('last_enrichment_attempt_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`fetch failed: ${error.message}`);
  return (data || []).map(rowToLead);
}

async function runEnrichment(leads, pythonBin) {
  leads.forEach(cleanLead);

  console.log(`  Crawling ${leads.length} websites for email/linkedin/contact...`);
  await enrichLeads(leads, 15);
  leads.forEach(cleanLead);

  const scrapegraph = config.scrapegraph || {};
  if (scrapegraph.enabled && pythonBin && scrapegraph.enrichment?.enabled !== false) {
    const stillMissing = leads.filter((l) => l.website && !l.email).length;
    if (stillMissing > 0) {
      console.log(`  [scrapegraph] Enriching ${stillMissing} leads still without email...`);
      const res = spawnSync(pythonBin, ['src/scrapers/scrapegraph_enricher.py', 'enrich'], {
        input: JSON.stringify(leads),
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
        env: { ...process.env },
      });
      if (res.stderr) process.stderr.write(res.stderr);
      if (res.status === 0 && res.stdout?.trim()) {
        try {
          const enriched = JSON.parse(res.stdout);
          if (Array.isArray(enriched) && enriched.length === leads.length) {
            leads = enriched;
            leads.forEach(cleanLead);
          }
        } catch (e) {
          console.error('  [scrapegraph] JSON parse error:', e.message);
        }
      }
    }
  }

  const firecrawl = config.firecrawl || {};
  if (firecrawl.enabled !== false) {
    await enrichWithFirecrawl(leads, firecrawl);
    leads.forEach(cleanLead);
  }

  console.log('  Verifying email domains (MX check)...');
  await verifyLeads(leads);

  scoreLeads(leads);
  return leads;
}

// Only the fields enrichment can actually change — never touches industry,
// region, lead_type, source, or anything the discovery/classification side
// owns, so this worker can't silently disturb data outside its own job.
const WRITABLE_INTERNAL_FIELDS = [
  'email', 'all_emails', 'contact_name', 'contact_title', 'linkedin',
  'facebook', 'instagram', 'email_verified', 'score', 'tier',
];

async function writeBack(supabase, leads) {
  let updated = 0;
  let failed = 0;
  const now = new Date().toISOString();
  for (const lead of leads) {
    const patch = { last_enrichment_attempt_at: now };
    for (const field of WRITABLE_INTERNAL_FIELDS) {
      if (lead[field] !== undefined && lead[field] !== '') patch[dbByInternal[field] ?? field] = lead[field];
    }
    const { error } = await supabase.from('leads').update(patch).eq('id', lead.id);
    if (error) {
      failed++;
      console.error(`  !! update failed for id=${lead.id}: ${error.message}`);
    } else {
      updated++;
    }
  }
  return { updated, failed };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing).');
    process.exit(1);
  }
  const pythonBin = resolvePythonBin();
  console.log(`Enrichment worker starting (batch size ${BATCH_SIZE}, python: ${pythonBin || 'not found — scrapegraph rung disabled'})`);

  let totalUpdated = 0;
  let totalFailed = 0;
  let cycles = 0;

  while (!shuttingDown) {
    cycles++;
    const batch = await fetchBatch(supabase);

    if (batch.length === 0) {
      console.log(`[cycle ${cycles}] No leads need enrichment right now. Sleeping ${IDLE_POLL_MS / 1000}s...`);
      if (RUN_ONCE) break;
      await sleep(IDLE_POLL_MS);
      continue;
    }

    console.log(`[cycle ${cycles}] Processing ${batch.length} leads...`);
    const enriched = await runEnrichment(batch, pythonBin);
    const { updated, failed } = await writeBack(supabase, enriched);
    totalUpdated += updated;
    totalFailed += failed;
    console.log(`[cycle ${cycles}] Done — ${updated} updated, ${failed} failed. Running totals: ${totalUpdated} updated, ${totalFailed} failed.`);

    if (RUN_ONCE) break;
    if (!shuttingDown) await sleep(BATCH_PAUSE_MS);
  }

  console.log(`\nStopped. Totals this run: ${totalUpdated} updated, ${totalFailed} failed.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
