// Firecrawl enricher — third-rung email/contact fallback, after emailFinder.js
// (rung 1: direct fetch + cheerio) and ScrapegraphAI (rung 2: LLM site visit,
// src/scrapers/scrapegraph_enricher.py). Only runs for leads still missing an
// email once both earlier rungs have had their turn.
//
// Firecrawl's /scrape endpoint renders JS and walks a site's real structure,
// so it can recover contact info from React/Vue company sites that a plain
// fetch() or ScrapegraphAI's ChromiumLoader still came back empty on.
//
// Entirely opt-in: without FIRECRAWL_API_KEY set, enrichWithFirecrawl() is a
// no-op that returns leads unchanged. Never throws — a single failed call
// just leaves that lead's fields as they were, exactly like the earlier rungs.
import { cleanEmail } from './cleanLead.js';

const API_URL = 'https://api.firecrawl.dev/v2/scrape';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
const JUNK_PATTERNS =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.(com|org)|@2x|@3x|^(xxx|email|name|user|your|test|firstname|lastname)@|@(xxx|domain|yourdomain|yoursite|sentry|example)\.|placeholder/i;

async function scrapeOne(website, { apiKey, timeoutMs }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: website, formats: ['markdown'], onlyMainContent: false }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const markdown = body?.data?.markdown || '';
  if (!markdown) return null;

  const emails = new Set();
  for (const m of markdown.match(EMAIL_RE) || []) {
    const email = cleanEmail(m);
    if (email && !JUNK_PATTERNS.test(email)) emails.add(email);
  }
  const linkedinMatch = markdown.match(/https?:\/\/[a-z]{2,3}\.linkedin\.com\/[^\s)"'\]]+/i);

  return {
    emails: [...emails],
    linkedin: linkedinMatch ? linkedinMatch[0] : '',
  };
}

/**
 * Runs Firecrawl over leads that have a website but still no email after
 * emailFinder + ScrapegraphAI. Mutates leads in place.
 *
 * opts:
 *   maxCalls  - hard cap on API calls per run (default 100 — stays inside
 *               Firecrawl's free tier of 500 credits/month even at 5 runs/wk)
 *   timeoutMs - per-page timeout
 *   apiKey    - defaults to process.env.FIRECRAWL_API_KEY
 */
export async function enrichWithFirecrawl(leads, opts = {}) {
  const {
    apiKey = process.env.FIRECRAWL_API_KEY,
    maxCalls = 100,
    timeoutMs = 25000,
    concurrency = 5,
  } = opts;

  if (!apiKey) {
    console.log('  [firecrawl] FIRECRAWL_API_KEY not set — skipped');
    return leads;
  }

  const candidates = leads.filter((l) => l.website && !l.email);
  if (candidates.length === 0) {
    console.log('  [firecrawl] no leads still missing email — skipped');
    return leads;
  }

  const queue = candidates.slice(0, maxCalls);
  const skipped = candidates.length - queue.length;
  let done = 0;
  let recovered = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      try {
        const result = await scrapeOne(lead.website, { apiKey, timeoutMs });
        if (result?.emails?.length) {
          lead.email = result.emails[0];
          const emailSet = new Set([...result.emails, ...(lead.all_emails ? lead.all_emails.split('; ') : [])]);
          lead.all_emails = [...emailSet].filter(Boolean).join('; ');
          recovered++;
        }
        if (result?.linkedin && !lead.linkedin) lead.linkedin = result.linkedin;
      } catch {
        /* leave lead as-is — earlier rungs' data is preserved */
      }
      done++;
      process.stdout.write(`  [firecrawl] checked ${done}/${queue.length + done}...\r`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log('');
  console.log(
    `  [firecrawl] recovered email for ${recovered}/${candidates.length} leads` +
      (skipped > 0 ? ` (${skipped} over the ${maxCalls}-call cap, left as-is)` : '')
  );
  return leads;
}
