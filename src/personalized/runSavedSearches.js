// Personalized scrape worker (roadmap Phase 6) — `node src/index.js saved-searches`.
//
// Turns queued/scheduled saved searches into real scrapes and attributes the
// results to the users who asked for them. Runs on GitHub Actions (see
// .github/workflows/personalized-scrape.yml), triggered either by a user
// pressing "Run now" in the dashboard (workflow_dispatch) or by the daily cron.
//
// Design notes:
//   - Every status the dashboard shows comes from a scrape_runs row this worker
//     writes. A run that fails ends up status='failed' with the error text, not
//     as a silent empty success.
//   - Saved searches that would scrape the same thing share one scrape (see
//     scrapeSignature) and are attributed separately, so cost scales with
//     distinct searches rather than with users.
//   - Leads go through the same runPipeline() as the weekly run, so personalized
//     leads get identical cleaning, dedupe, enrichment, classification, web
//     tagging and scoring. No second-class path.
import { getSupabaseClient } from '../lib/supabaseClient.js';
import { gatherLeads } from '../sources/index.js';
import { runPipeline } from '../pipeline/runPipeline.js';
import { syncLeadsToSupabase } from '../lib/pushToSupabase.js';
import { buildScrapeConfig, describeCoverage, scrapeSignature } from './targeting.js';
import { buildUserLeadRows } from './attribution.js';

// Bounds so a runaway queue can't burn the Actions budget in one invocation.
const MAX_RUNS_PER_INVOCATION = 10;
const MAX_GROUPS_PER_INVOCATION = 5;

const DUE_AFTER_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };

/** Saved searches whose schedule has come due since their last run. */
export function isScheduleDue(savedSearch, now = Date.now()) {
  const interval = DUE_AFTER_MS[savedSearch.schedule];
  if (!interval) return false; // 'off', null, or unknown cadence
  if (!savedSearch.is_active) return false;
  if (!savedSearch.last_run_at) return true;
  return now - new Date(savedSearch.last_run_at).getTime() >= interval;
}

/**
 * Groups claimed runs by what would actually be scraped.
 *
 * Two users who both saved "AI / ML in the Middle East" describe the same
 * scrape, so they share one — the results are then attributed to each of them
 * separately, since their non-scrapeable filters (tier, minScore, hasEmail)
 * can still differ. Without this, scraping cost scales with users instead of
 * with distinct searches.
 */
export function groupBySignature(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const filter = entry.search.filter_json || {};
    const depth = entry.search.depth === 'deep' ? 'deep' : 'quick';
    const sig = scrapeSignature(filter, depth);
    if (!groups.has(sig)) groups.set(sig, { signature: sig, filter, depth, entries: [] });
    groups.get(sig).entries.push(entry);
  }
  return [...groups.values()];
}

// ── Queue management ────────────────────────────────────────────────────────

// Turns due scheduled searches into pending run rows, so the scheduled path and
// the "Run now" path converge on the same queue and the same status reporting.
async function enqueueScheduledRuns(supabase) {
  const { data: searches, error } = await supabase
    .from('saved_searches')
    .select('id, user_id, schedule, is_active, last_run_at')
    .eq('is_active', true);
  if (error) {
    console.error(`  !! Could not read saved_searches: ${error.message}`);
    return 0;
  }

  const due = (searches || []).filter((s) => isScheduleDue(s));
  if (due.length === 0) return 0;

  const { error: insErr } = await supabase.from('scrape_runs').insert(
    due.map((s) => ({
      user_id: s.user_id,
      saved_search_id: s.id,
      trigger: 'schedule',
      status: 'pending',
    }))
  );
  if (insErr) {
    console.error(`  !! Could not enqueue scheduled runs: ${insErr.message}`);
    return 0;
  }
  console.log(`  Enqueued ${due.length} scheduled run(s)`);
  return due.length;
}

// Claims pending runs and joins each to the saved search it belongs to.
async function claimPendingRuns(supabase) {
  const { data: runs, error } = await supabase
    .from('scrape_runs')
    .select('id, user_id, saved_search_id, trigger, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_RUNS_PER_INVOCATION);
  if (error) {
    console.error(`  !! Could not read scrape_runs: ${error.message}`);
    return [];
  }
  if (!runs || runs.length === 0) return [];

  const ids = runs.map((r) => r.id);
  const { error: updErr } = await supabase
    .from('scrape_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .in('id', ids);
  if (updErr) {
    console.error(`  !! Could not mark runs as running: ${updErr.message}`);
    return [];
  }

  const searchIds = [...new Set(runs.map((r) => r.saved_search_id).filter(Boolean))];
  const { data: searches } = await supabase
    .from('saved_searches')
    .select('id, user_id, name, filter_json, depth')
    .in('id', searchIds);
  const byId = new Map((searches || []).map((s) => [s.id, s]));

  return runs
    .map((run) => ({ run, search: byId.get(run.saved_search_id) }))
    .filter((entry) => {
      if (entry.search) return true;
      // Saved search deleted between queueing and execution.
      finishRun(supabase, entry.run.id, { status: 'failed', error: 'Saved search no longer exists', leadsFound: 0 });
      return false;
    });
}

async function finishRun(supabase, runId, { status, error = null, leadsFound = null }) {
  const { error: updErr } = await supabase
    .from('scrape_runs')
    .update({
      status,
      error,
      leads_found: leadsFound,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (updErr) console.error(`  !! Could not finalize run ${runId}: ${updErr.message}`);
}

// ── Execution ───────────────────────────────────────────────────────────────

/**
 * Scrapes once for a group of saved searches that share a scrape signature,
 * then attributes the results to each member separately (their non-scrapeable
 * filters — tier, score, hasEmail — can still differ).
 */
async function executeGroup(supabase, group, { config, cloak, pythonBin }) {
  const { filter, depth, entries } = group;
  const { config: scrapeConfig, only, coverage } = buildScrapeConfig(filter, { depth });
  const summary = describeCoverage(coverage);
  console.log(`\n[personalized] ${entries.length} search(es) — ${summary}`);

  if (coverage.jobCount === 0) {
    // Honest failure: nothing was scraped, so this is not a successful zero.
    for (const { run } of entries) {
      await finishRun(supabase, run.id, { status: 'failed', error: summary, leadsFound: 0 });
    }
    return;
  }

  const raw = await gatherLeads({ ...scrapeConfig, cloak }, cloak, { only, pythonBin });
  console.log(`[personalized] gathered ${raw.length} raw leads`);

  const leads = await runPipeline(raw, { config, pythonBin });
  console.log(`[personalized] ${leads.length} leads survived the quality pipeline`);

  const { idsByKey } = await syncLeadsToSupabase(leads);

  for (const { run, search } of entries) {
    try {
      const rows = buildUserLeadRows(leads, {
        userId: search.user_id,
        savedSearchId: search.id,
        scrapeRunId: run.id,
        filter: search.filter_json || {},
        idsByKey,
      });

      let delivered = 0;
      if (rows.length > 0) {
        // ignoreDuplicates keeps the unique(user_id, lead_id) constraint as the
        // guarantee that a lead is never delivered to the same user twice.
        const { data, error } = await supabase
          .from('user_leads')
          .upsert(rows, { onConflict: 'user_id,lead_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(error.message);
        delivered = (data || []).length;
      }

      await finishRun(supabase, run.id, { status: 'done', leadsFound: delivered });
      await supabase
        .from('saved_searches')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', search.id);
      console.log(`[personalized] "${search.name}" — delivered ${delivered} new lead(s)`);
    } catch (err) {
      await finishRun(supabase, run.id, { status: 'failed', error: err.message, leadsFound: 0 });
      console.error(`[personalized] "${search.name}" attribution failed: ${err.message}`);
    }
  }
}

/**
 * Entry point. Enqueues due scheduled searches, claims the pending queue,
 * groups by scrape signature, and executes each group.
 */
export async function runSavedSearches({ config, cloak = {}, pythonBin = null } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log('Supabase not configured — personalized runs need SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
    return { runs: 0 };
  }

  console.log('Personalized lead runs starting\n');
  await enqueueScheduledRuns(supabase);

  const entries = await claimPendingRuns(supabase);
  if (entries.length === 0) {
    console.log('  No pending runs — nothing to do.');
    return { runs: 0 };
  }
  console.log(`  Claimed ${entries.length} run(s)`);

  // Identical searches from different users cost one scrape instead of N.
  const groups = groupBySignature(entries);

  const selected = groups.slice(0, MAX_GROUPS_PER_INVOCATION);
  const deferred = groups.length - selected.length;
  if (deferred > 0) {
    console.log(`  ${deferred} group(s) deferred to the next invocation (cap ${MAX_GROUPS_PER_INVOCATION})`);
    for (const group of groups.slice(MAX_GROUPS_PER_INVOCATION)) {
      for (const { run } of group.entries) {
        await supabase.from('scrape_runs').update({ status: 'pending', started_at: null }).eq('id', run.id);
      }
    }
  }

  for (const group of selected) {
    try {
      await executeGroup(supabase, group, { config, cloak, pythonBin });
    } catch (err) {
      // One broken group never aborts the rest — mirrors gatherLeads' per-source resilience.
      console.error(`[personalized] group failed: ${err.message}`);
      for (const { run } of group.entries) {
        await finishRun(supabase, run.id, { status: 'failed', error: err.message, leadsFound: 0 });
      }
    }
  }

  console.log('\nPersonalized runs complete.');
  return { runs: selected.reduce((n, g) => n + g.entries.length, 0) };
}
