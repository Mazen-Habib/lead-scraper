// Default ICP keywords used when config.qualityFilter.categoryKeywords is absent.
export const DEFAULT_CATEGORY_KEYWORDS = [
  'software', 'technology', 'tech', 'it services', 'information technology',
  'web', 'app', 'developer', 'development', 'digital', 'systems', 'solutions',
  'computer', 'network', 'cyber', 'cloud', 'saas', 'mobile', 'data',
  'electronics', 'telecommunication',
];

/**
 * True if the lead's category (or name, as a fallback for sources that don't
 * provide a category) contains one of the ICP keywords.
 */
export function matchesIcp(lead, keywords = DEFAULT_CATEGORY_KEYWORDS) {
  const haystack = `${lead.category || ''} ${lead.name || ''}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

/**
 * True if the lead has at least one usable way to reach it: a phone number,
 * a LinkedIn profile, or an email that isn't confirmed dead.
 */
export function hasContactPoint(lead) {
  if (lead.phone) return true;
  if (lead.linkedin) return true;
  if (lead.email && lead.email_verified !== 'dead') return true;
  return false;
}

/**
 * Applies a predicate to a lead list, logging how many were dropped and why
 * so filtering is never silent.
 */
function applyFilter(leads, predicate, label) {
  const kept = leads.filter(predicate);
  const dropped = leads.length - kept.length;
  if (dropped > 0) console.log(`  ${dropped} leads dropped: ${label}`);
  return kept;
}

export function filterByIcp(leads, config = {}) {
  const keywords = config.qualityFilter?.categoryKeywords || DEFAULT_CATEGORY_KEYWORDS;
  return applyFilter(leads, (lead) => matchesIcp(lead, keywords), 'off-ICP category');
}

export function filterByContactPoint(leads) {
  return applyFilter(leads, hasContactPoint, 'no usable contact point (no email/phone/linkedin)');
}
