/**
 * One-shot ScrapeGraph hosted-API enrichment.
 *
 * Spends the ScrapeGraph account's finite credit balance on the highest-value
 * leads we have that are still missing an email, writes the recovered contact
 * details back to Supabase, and stops. It is meant to be run by hand, once,
 * and then left alone — which is why it is a script rather than a rung in
 * runPipeline.js, and why no workflow in .github/workflows/ calls it.
 *
 * The free plan's credits do not refill, so the ordering matters more than the
 * throughput: candidates come back score-descending, so the ~100 calls a full
 * balance buys land on the best leads in the database rather than an arbitrary
 * hundred. Everything else is left exactly as the free rungs
 * (emailFinder → scrapegraph_enricher.py → Firecrawl) left it.
 *
 * Usage:
 *   node scripts/scrapegraph-enrich-once.js --dry-run   # show plan + balance, spend nothing
 *   node scripts/scrapegraph-enrich-once.js             # spend the whole balance
 *   node scripts/scrapegraph-enrich-once.js --limit=10  # spend at most 10 calls
 *   node scripts/scrapegraph-enrich-once.js --reserve=100 --limit=20
 *   node scripts/scrapegraph-enrich-once.js --target=email   # socials (default) | email | phone
 *
 * Requires SCRAPEGRAPH_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import 'dotenv/config';
import { getSupabaseClient } from '../src/lib/supabaseClient.js';
import { CSV_COLUMNS } from '../src/lib/leadFields.js';
import { cleanLead } from '../src/lib/cleanLead.js';
import {
  enrichWithScrapeGraphApi,
  getCredits,
  CREDITS_PER_CALL,
} from '../src/lib/scrapegraphApiEnricher.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const numArg = (name, fallback) => {
  const raw = (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};
const LIMIT = numArg('limit', Infinity);
const RESERVE = numArg('reserve', 0);

// Which gap to spend the credits on. Measured yield on a 3-lead live sample:
// the hosted API filled LinkedIn/Facebook/Instagram on 3/3 leads but recovered
// an email on 0/3 — company homepages route contact through a form rather than
// a mailto:, and our free rungs have already crawled the contact pages by the
// time a lead reaches this script. 'socials' is therefore the higher-yield
// target even though 'email' is the scarcer field. See README for the numbers.
const TARGET = (args.find((a) => a.startsWith('--target=')) || '').split('=')[1] || 'socials';
const TARGET_FILTERS = {
  email: 'email.is.null,email.eq.',
  socials: 'linkedin.is.null,linkedin.eq.,facebook.is.null,facebook.eq.',
  phone: 'phone.is.null,phone.eq.',
};
// The client-side twin of TARGET_FILTERS, applied inside the enricher. Kept
// beside it so the two can't drift.
const NEEDS = {
  email: (l) => l.website && !l.email,
  socials: (l) => l.website && (!l.linkedin || !l.facebook),
  phone: (l) => l.website && !l.phone,
};
if (!TARGET_FILTERS[TARGET]) {
  console.error(`Unknown --target=${TARGET}. Use one of: ${Object.keys(TARGET_FILTERS).join(', ')}.`);
  process.exit(1);
}

const internalByDb = Object.fromEntries(CSV_COLUMNS.map(([internal, db]) => [db, internal]));
const dbByInternal = Object.fromEntries(CSV_COLUMNS.map(([internal, db]) => [internal, db]));

// Only what this enricher can legitimately discover. Mirrors the same guard in
// scripts/enrichment-worker.js: discovery and classification own every other
// column, and a contact-details pass must not disturb them.
const WRITABLE = ['email', 'all_emails', 'phone', 'linkedin', 'facebook', 'instagram'];

// A full balance buys ~100 calls, so pull a candidate pool a few times that
// size and let score ordering decide — no point paging through thousands.
const CANDIDATE_POOL = 500;

async function fetchCandidates(supabase) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, company_name, website, email, phone, linkedin, facebook, instagram, all_emails, score')
    .not('website', 'is', null)
    .neq('website', '')
    .or(TARGET_FILTERS[TARGET])
    .order('score', { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_POOL);
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);

  return (data || []).map((row) => {
    const lead = { id: row.id };
    for (const [db, val] of Object.entries(row)) {
      if (db === 'id') continue;
      lead[internalByDb[db] ?? db] = val ?? '';
    }
    return lead;
  });
}

async function writeBack(supabase, leads, before) {
  let updated = 0;
  let failed = 0;

  for (const lead of leads) {
    const patch = {};
    for (const field of WRITABLE) {
      const value = lead[field];
      // Only fields this run actually filled in — an untouched lead costs no
      // write, and a pre-existing value is never overwritten.
      if (value && value !== before.get(lead.id)?.[field]) patch[dbByInternal[field] ?? field] = value;
    }
    if (Object.keys(patch).length === 0) continue;

    patch.last_enrichment_attempt_at = new Date().toISOString();
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

async function main() {
  const apiKey = process.env.SCRAPEGRAPH_API_KEY;
  if (!apiKey) {
    console.error('SCRAPEGRAPH_API_KEY is not set. Put it in .env (never commit it).');
    process.exit(1);
  }

  const credits = await getCredits(apiKey);
  if (!credits) {
    console.error('Could not read the ScrapeGraph credit balance — aborting rather than spending blind.');
    process.exit(1);
  }
  const affordable = Math.floor(Math.max(0, credits.remaining - RESERVE) / CREDITS_PER_CALL);
  console.log(
    `ScrapeGraph "${credits.plan}": ${credits.remaining} credits remaining, ` +
      `${credits.used} used. At ${CREDITS_PER_CALL}/call that is ${affordable} calls` +
      (RESERVE ? ` (holding ${RESERVE} in reserve)` : '') +
      '.'
  );

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).');
    process.exit(1);
  }

  const candidates = await fetchCandidates(supabase);
  console.log(
    `${candidates.length} leads have a website and a '${TARGET}' gap (top ${CANDIDATE_POOL} by score).`
  );
  if (candidates.length === 0) return;

  const planned = Math.min(affordable, LIMIT, candidates.length);
  if (DRY_RUN) {
    console.log(`\n--dry-run: would enrich ${planned} leads, spending ${planned * CREDITS_PER_CALL} credits.`);
    console.log('First 10 in line:');
    for (const lead of candidates.slice(0, 10)) {
      console.log(`  score ${String(lead.score ?? '–').padStart(3)}  ${lead.name} — ${lead.website}`);
    }
    return;
  }

  // Snapshot pre-enrichment values so writeBack only sends genuinely new data.
  const before = new Map(candidates.map((l) => [l.id, { ...l }]));

  const summary = await enrichWithScrapeGraphApi(candidates, {
    apiKey,
    // Must agree with TARGET_FILTERS above: the enricher re-checks the gap
    // itself, so a mismatch here would silently discard every candidate.
    needs: NEEDS[TARGET],
    maxCalls: LIMIT,
    reserve: RESERVE,
  });

  candidates.forEach(cleanLead);
  const { updated, failed } = await writeBack(supabase, candidates, before);

  console.log(
    `\nDone. ${summary.attempted} leads attempted, ${summary.recovered} emails recovered, ` +
      `${summary.fieldsAdded} fields added; ${updated} rows updated in Supabase, ${failed} failed.`
  );
  console.log(
    `Credits: ${summary.remainingBefore} → ${summary.remainingAfter}. ` +
      'When this hits zero the account is done — do not wire this script into a cron.'
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
