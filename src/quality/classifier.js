// Rules-based lead classifier (roadmap 3.2) — deterministic, free, first pass.
// Assigns a primary `industry` plus additional `tags`/`sub_industries` from
// the shared taxonomy (../../shared/taxonomy.json), the same definition the
// frontend's LeadsTable service filter uses, so the scraper, API, and UI
// never drift out of sync on what "AI / ML" or "Digital Marketing" means.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAXONOMY = JSON.parse(readFileSync(resolve(root, 'shared/taxonomy.json'), 'utf8'));

// Signals available at classification time that the plain category filter
// ignores: the raw category, search_query, website domain, and the slug at
// the end of a directory profile_url (Clutch/DesignRush encode category
// there, e.g. clutch.co/profile/acme-web-development-agency).
function classifierHaystack(lead) {
  const domainWords = (lead.website || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[.\-\/]/g, ' ');
  // Directory profile URLs (Clutch/DesignRush) end in a readable slug like
  // "acme-web-development-agency" — Google Maps URLs end in a coordinate/data
  // blob like "data=!4m7!3m6!1s0x...", which falsely matched taxonomy
  // keywords (e.g. the literal "data" in "data=" matching data-analytics-bi).
  // Any '=', '!' or '%' in the last segment means it isn't a real slug.
  const rawSlug = (lead.maps_url || '').split('/').pop() || '';
  const slugWords = /[=!%]/.test(rawSlug) ? '' : rawSlug.replace(/[-_]/g, ' ');
  return [lead.category, lead.name, lead.search_query, domainWords, slugWords]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary matcher, used when the haystack is full page prose rather
// than the short metadata string. Plain substring matching is fine on
// "acme-ai.com" but disastrous over a whole homepage: short taxonomy
// keywords like "bi", "etl" and "erp" would hit inside "ambient",
// "hotel" and "enterprise". Cached because the regex set is rebuilt for
// every lead we tag from the web otherwise.
const boundaryReCache = new Map();
function matchesWord(haystack, keyword) {
  let re = boundaryReCache.get(keyword);
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(keyword)}(?:[^a-z0-9]|$)`, 'i');
    boundaryReCache.set(keyword, re);
  }
  return re.test(haystack);
}

/**
 * Scores a lowercased haystack against every taxonomy bucket.
 * Returns hits sorted by keyword-match count, richest bucket first.
 * `wordBoundary` switches from substring to whole-word matching — see
 * matchesWord above for why long prose needs it.
 */
export function matchTaxonomy(haystack, { wordBoundary = false } = {}) {
  const hits = [];
  for (const { slug, keywords } of TAXONOMY.industries) {
    const matched = keywords.filter((kw) =>
      wordBoundary ? matchesWord(haystack, kw) : haystack.includes(kw)
    );
    if (matched.length > 0) hits.push({ slug, matchCount: matched.length });
  }
  hits.sort((a, b) => b.matchCount - a.matchCount);
  return hits;
}

/**
 * Classifies a single lead against the shared taxonomy.
 * Returns { industry, tags, sub_industries, confidence, tag_source } —
 * `industry` is the highest-scoring bucket (by keyword-hit count), `tags`
 * includes every bucket slug that matched at all, `confidence` is 0 when
 * nothing matched (caller should fall back to the web tagger, then the LLM
 * classifier, 3.3).
 */
export function classifyLead(lead) {
  const hits = matchTaxonomy(classifierHaystack(lead));

  if (hits.length === 0) {
    return { industry: null, tags: [], sub_industries: [], confidence: 0, tag_source: 'rules' };
  }

  const industry = hits[0].slug;
  const tags = hits.map((h) => h.slug);
  const sub_industries = tags.slice(1);

  // Confidence: more keyword hits and a clear leader over the runner-up both
  // raise confidence. Capped at 0.95 — rules never claim full certainty,
  // leaving room for the LLM pass (3.3) to override on ambiguous cases.
  const topCount = hits[0].matchCount;
  const runnerUpCount = hits[1]?.matchCount ?? 0;
  const margin = topCount - runnerUpCount;
  const confidence = Math.min(0.95, 0.5 + 0.1 * topCount + 0.1 * margin);

  return { industry, tags, sub_industries, confidence, tag_source: 'rules' };
}

/** Classifies every lead in place, setting industry/tags/sub_industries/tag_confidence/tag_source. */
export function classifyLeads(leads) {
  let classified = 0;
  for (const lead of leads) {
    const result = classifyLead(lead);
    lead.industry = result.industry;
    lead.tags = result.tags;
    lead.sub_industries = result.sub_industries;
    lead.tag_confidence = result.confidence;
    lead.tag_source = result.tag_source;
    if (result.industry) classified++;
  }
  console.log(`  Classified ${classified}/${leads.length} leads with an industry (rules pass)`);
  return leads;
}

export { TAXONOMY };
