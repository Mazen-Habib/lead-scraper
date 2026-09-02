// ScrapeGraph *hosted API* enricher — https://docs.scrapegraphai.com
//
// NOT the same thing as src/scrapers/scrapegraph_enricher.py. That module runs
// the open-source `scrapegraphai` Python package locally against our own
// Groq/Mistral/OpenRouter keys, and is free to call as often as we like. This
// one calls ScrapeGraph's paid hosted service (`sgai-…` key), which bills
// CREDITS_PER_CALL credits per extraction from a fixed balance.
//
// Because the balance is finite and does not refill on the free plan, this is
// deliberately a ONE-SHOT tool, not a pipeline rung: it is wired into
// scripts/scrapegraph-enrich-once.js only, and is intentionally absent from
// runPipeline.js and every workflow in .github/workflows/. Enrich once, spend
// the credits, stop. Anything recurring belongs on the free rungs
// (emailFinder → scrapegraph_enricher.py → Firecrawl).
//
// Budget safety is enforced in three independent places, so no combination of
// concurrency, retries, or a wrong caller argument can overspend:
//   1. the live balance is read from /api/credits before any extraction,
//   2. the work queue is pre-sliced to exactly the affordable number of calls,
//   3. a 402 / insufficient-credits response halts every worker immediately.
import { cleanEmail, cleanPhone, cleanUrl, cleanStr } from './cleanLead.js';

const API_BASE = 'https://v2-api.scrapegraphai.com/api';

// Measured against the live API, not documented: balance went 500 → 495 for a
// single /api/extract call. If ScrapeGraph changes its pricing this constant
// is the one thing to update — the budget math all derives from it.
const CREDITS_PER_CALL = 5;

// The hosted model answers with this literal string (not null, not "") when a
// field genuinely isn't on the page. Writing it into a lead would poison the
// row, so every extracted value is checked against it. Asking for null in the
// prompt mostly avoids it, but the model is not reliable about that.
const NULL_ANSWERS = new Set([
  'no content available',
  'not available',
  'not found',
  'not present',
  'none',
  'null',
  'n/a',
  'na',
  '',
]);

const JUNK_EMAIL =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.(com|org)|@2x|@3x|^(xxx|email|name|user|your|test|firstname|lastname)@|@(xxx|domain|yourdomain|yoursite|sentry|example)\.|placeholder/i;

const EXTRACT_PROMPT =
  'Extract the company contact information from this website: primary contact ' +
  'email address, phone number with country code, LinkedIn company URL, ' +
  'Facebook page URL, Instagram profile URL. Only include values explicitly ' +
  'present on the page. Use null for anything not present — never guess, ' +
  'invent, or return placeholder text.';

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    email: { type: 'string' },
    phone: { type: 'string' },
    linkedin: { type: 'string' },
    facebook: { type: 'string' },
    instagram: { type: 'string' },
  },
};

/** Rejects the model's "missing value" sentinels before they reach a lead. */
function usable(value) {
  const str = cleanStr(value);
  if (!str) return '';
  return NULL_ANSWERS.has(str.toLowerCase()) ? '' : str;
}

/**
 * Reads the live credit balance. Returns null on any failure — callers treat
 * that as "cannot verify budget" and refuse to spend, which is the safe
 * direction to fail in.
 */
export async function getCredits(apiKey, timeoutMs = 15000) {
  try {
    const res = await fetch(`${API_BASE}/credits`, {
      headers: { 'SGAI-APIKEY': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.remaining === 'number' ? body : null;
  } catch {
    return null;
  }
}

/**
 * One extraction. Resolves to { fields } on success, or { exhausted: true }
 * when the account is out of credits so the caller can stop the whole run
 * rather than burning the remaining queue on guaranteed failures.
 */
async function extractOne(website, { apiKey, timeoutMs }) {
  const res = await fetch(`${API_BASE}/extract`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'SGAI-APIKEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: website, prompt: EXTRACT_PROMPT, schema: EXTRACT_SCHEMA }),
  });

  if (res.status === 402 || res.status === 429) return { exhausted: true };
  if (!res.ok) return null;

  const body = await res.json();
  const json = body?.json;
  if (!json || typeof json !== 'object') return null;

  const email = cleanEmail(usable(json.email));
  return {
    fields: {
      email: email && !JUNK_EMAIL.test(email) ? email : '',
      phone: cleanPhone(usable(json.phone)),
      linkedin: cleanUrl(usable(json.linkedin)),
      facebook: cleanUrl(usable(json.facebook)),
      instagram: cleanUrl(usable(json.instagram)),
    },
  };
}

/**
 * Enriches leads through the hosted ScrapeGraph API, spending at most the
 * credits currently on the account. Mutates leads in place and never throws.
 *
 * opts:
 *   apiKey       - defaults to process.env.SCRAPEGRAPH_API_KEY
 *   needs        - predicate picking which leads are worth a call. Defaults to
 *                  "has a website but no email"; callers targeting a different
 *                  gap (socials, phone) must pass their own, or every candidate
 *                  they selected would be filtered straight back out here.
 *   maxCalls     - caller's own ceiling; the affordable count still wins if lower
 *   reserve      - credits to leave unspent (default 0)
 *   timeoutMs    - per-extraction timeout
 *   concurrency  - parallel extractions (queue is pre-sliced, so this cannot
 *                  affect how many calls are made, only how fast)
 *
 * Returns { attempted, recovered, fieldsAdded, creditsSpent, remainingBefore,
 *           remainingAfter, skippedOverBudget, exhausted }.
 */
export async function enrichWithScrapeGraphApi(leads, opts = {}) {
  const {
    apiKey = process.env.SCRAPEGRAPH_API_KEY,
    needs = (lead) => lead.website && !lead.email,
    maxCalls = Infinity,
    reserve = 0,
    timeoutMs = 60000,
    concurrency = 3,
  } = opts;

  const summary = {
    attempted: 0,
    recovered: 0,
    fieldsAdded: 0,
    creditsSpent: 0,
    remainingBefore: null,
    remainingAfter: null,
    skippedOverBudget: 0,
    exhausted: false,
  };

  if (!apiKey) {
    console.log('  [scrapegraph-api] SCRAPEGRAPH_API_KEY not set — skipped');
    return summary;
  }

  const candidates = leads.filter(needs);
  if (candidates.length === 0) {
    console.log('  [scrapegraph-api] no leads match the enrichment criterion — skipped');
    return summary;
  }

  const credits = await getCredits(apiKey);
  if (!credits) {
    console.log('  [scrapegraph-api] could not read credit balance — refusing to spend, skipped');
    return summary;
  }
  summary.remainingBefore = credits.remaining;

  const spendable = Math.max(0, credits.remaining - reserve);
  const affordable = Math.floor(spendable / CREDITS_PER_CALL);
  const budget = Math.min(affordable, maxCalls, candidates.length);

  console.log(
    `  [scrapegraph-api] ${credits.remaining} credits on "${credits.plan}" ` +
      `(${CREDITS_PER_CALL}/call → ${affordable} calls affordable), ` +
      `${candidates.length} leads match → running ${budget}`
  );

  if (budget === 0) {
    console.log('  [scrapegraph-api] no affordable calls left — nothing to do');
    summary.remainingAfter = credits.remaining;
    return summary;
  }

  // Pre-slicing here is what makes the budget hard: workers can only ever
  // consume what is already in the queue, whatever the concurrency.
  const queue = candidates.slice(0, budget);
  summary.skippedOverBudget = candidates.length - queue.length;
  const total = queue.length;
  let stop = false;

  async function worker() {
    while (queue.length > 0 && !stop) {
      const lead = queue.shift();
      summary.attempted++;
      try {
        const result = await extractOne(lead.website, { apiKey, timeoutMs });
        if (result?.exhausted) {
          // Out of credits mid-run: abandon the rest instead of hammering the
          // API with calls that cannot succeed.
          stop = true;
          summary.exhausted = true;
          break;
        }
        if (result?.fields) {
          summary.creditsSpent += CREDITS_PER_CALL;
          let added = 0;
          for (const [field, value] of Object.entries(result.fields)) {
            if (value && !lead[field]) {
              lead[field] = value;
              added++;
            }
          }
          if (result.fields.email && !lead.all_emails) lead.all_emails = result.fields.email;
          if (result.fields.email) summary.recovered++;
          summary.fieldsAdded += added;
        } else {
          // A failed extraction still bills, so count it against the budget.
          summary.creditsSpent += CREDITS_PER_CALL;
        }
      } catch {
        /* leave the lead exactly as the free rungs left it */
      }
      process.stdout.write(
        `  [scrapegraph-api] ${summary.attempted}/${total} done, ${summary.recovered} emails found...\r`
      );
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log('');

  const after = await getCredits(apiKey);
  summary.remainingAfter = after?.remaining ?? null;

  console.log(
    `  [scrapegraph-api] recovered an email for ${summary.recovered}/${summary.attempted} leads, ` +
      `${summary.fieldsAdded} fields added` +
      (summary.exhausted ? ' (stopped early — credits exhausted)' : '') +
      (summary.skippedOverBudget > 0
        ? `; ${summary.skippedOverBudget} leads left untouched (over budget)`
        : '')
  );
  if (summary.remainingAfter !== null) {
    console.log(`  [scrapegraph-api] credits remaining: ${summary.remainingAfter}`);
  }

  return summary;
}

export { CREDITS_PER_CALL };
