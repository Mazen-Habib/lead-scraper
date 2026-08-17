// Runtime tagging fallback (roadmap 3.2b) — recovers an industry for leads the
// rules classifier couldn't place.
//
// The rules pass (classifier.js) only sees metadata: category, company name,
// domain words, directory-slug. Plenty of real leads arrive with category
// "Company" or "Software" and a domain like "nexoraglobal.com" — nothing to
// match a taxonomy keyword against, so they land with industry=null and get
// scored/filtered as unclassified noise despite being perfectly good leads.
//
// Their own homepage states what they do in plain words. This pass fetches
// that page as clean Markdown via Jina Reader and re-runs the same taxonomy
// matcher over the real prose, so tagging happens automatically during the
// run instead of needing a manual pass afterwards.
//
// Deliberately conservative:
//   - only touches leads the rules pass left unclassified (never overwrites)
//   - whole-word keyword matching (page prose, not a short slug)
//   - requires >= minKeywordHits before accepting a bucket, so a single
//     incidental "cloud" on a contact page can't mislabel a company
//   - confidence capped below the rules pass — page text is weaker evidence
//     than an explicit directory category
//   - every failure is a silent skip; this must never break a 6h run
import { matchTaxonomy } from './classifier.js';
import { readAsText, createPacer } from '../lib/jinaReader.js';
import { readViaMarkItDown } from '../lib/markitdownReader.js';

// Page evidence is noisier than a curated directory category, so it tops out
// lower than the rules pass's 0.95 — a later LLM pass should still be free to
// override anything tagged here.
const MAX_CONFIDENCE = 0.75;

/**
 * Derives taxonomy tags from a company's homepage prose.
 * Returns null when the page yields no confident bucket.
 */
export async function tagFromWebsite(website, { timeoutMs, minKeywordHits = 2, pace, pythonBin } = {}) {
  if (pace) await pace();
  let text = await readAsText(website, { timeoutMs });
  // Second rung: Jina came back empty (timeout, rate-limited, refused) — try
  // MarkItDown locally instead. No-op if pythonBin isn't available.
  if (!text) text = readViaMarkItDown(website, { pythonBin, timeoutMs });
  if (!text) return null;

  const hits = matchTaxonomy(text.toLowerCase(), { wordBoundary: true });
  if (hits.length === 0 || hits[0].matchCount < minKeywordHits) return null;

  const tags = hits.filter((h) => h.matchCount >= minKeywordHits).map((h) => h.slug);
  const topCount = hits[0].matchCount;
  const runnerUpCount = hits[1]?.matchCount ?? 0;
  const confidence = Math.min(MAX_CONFIDENCE, 0.3 + 0.05 * topCount + 0.05 * (topCount - runnerUpCount));

  return {
    industry: hits[0].slug,
    tags,
    sub_industries: tags.slice(1),
    confidence: Number(confidence.toFixed(2)),
    tag_source: 'web',
  };
}

/**
 * Fills in industry/tags for every still-unclassified lead that has a website.
 * Mutates leads in place and returns them, matching classifyLeads' contract.
 *
 * opts (from config.webTagging):
 *   concurrency       - parallel Jina fetches (default 3; requestsPerMinute is
 *                       the real throughput bound, this just overlaps latency)
 *   requestsPerMinute - shared pacing ceiling. Jina's keyless tier allows ~20
 *                       req/min per IP; 18 leaves headroom. Set 0 to disable.
 *   maxLeads          - hard cap on fetches per run, so a run that dedupes badly
 *                       can't fire thousands of requests at a free service
 *   timeoutMs         - per-page fetch timeout
 *   minKeywordHits    - keyword hits required before accepting a bucket
 */
export async function tagLeadsFromWeb(leads, opts = {}) {
  const {
    concurrency = 3,
    requestsPerMinute = 18,
    maxLeads = 300,
    timeoutMs = 20000,
    minKeywordHits = 2,
    pythonBin = null,
  } = opts;

  const candidates = leads.filter((l) => l.website && !l.industry);
  if (candidates.length === 0) {
    console.log('  Web tagging: no unclassified leads with a website — skipped');
    return leads;
  }

  const queue = candidates.slice(0, maxLeads);
  const skipped = candidates.length - queue.length;
  const pace = createPacer(requestsPerMinute > 0 ? Math.ceil(60000 / requestsPerMinute) : 0);
  let tagged = 0;
  let attempted = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      attempted++;
      try {
        const result = await tagFromWebsite(lead.website, { timeoutMs, minKeywordHits, pace, pythonBin });
        if (result) {
          lead.industry = result.industry;
          lead.tags = result.tags;
          lead.sub_industries = result.sub_industries;
          lead.tag_confidence = result.confidence;
          lead.tag_source = result.tag_source;
          tagged++;
        }
      } catch {
        /* a single unreachable site never fails the run */
      }
      process.stdout.write(`  Web-tagged ${tagged}/${attempted} checked...\r`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log('');
  console.log(
    `  Web tagging: recovered an industry for ${tagged}/${candidates.length} unclassified leads` +
      (skipped > 0 ? ` (${skipped} over the ${maxLeads}-lead cap, left untagged)` : '')
  );
  return leads;
}
