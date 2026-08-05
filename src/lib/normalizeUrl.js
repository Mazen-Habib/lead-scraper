/**
 * Normalizes a website URL into a stable dedupe key so the same company
 * scraped as http://acme.com, https://acme.com, https://www.acme.com/,
 * and https://www.acme.com/en all collapse to one lead. We use domain-only
 * (strip path) because scrapers may link to different pages of the same site.
 */
export function normalizeUrl(value) {
  if (!value) return '';
  let v = String(value).trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '');
  v = v.replace(/^www\./, '');
  v = v.split('/')[0];   // domain only — strips path so /en and /about don't create separate leads
  v = v.split('?')[0];   // strip any query string still on the domain itself
  return v;
}

// Common legal-entity suffixes that make "Acme Corp" and "Acme Corporation"
// look like different companies to a naive string match.
const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|pvt|private|fz-llc|fze|llp|plc|gmbh|sa|srl|pty)\.?\b/gi;

/**
 * Normalizes a company name for dedupe/matching by lowercasing, stripping
 * punctuation and legal-entity suffixes, and collapsing whitespace, so
 * "Acme Corp." and "Acme Corporation" resolve to the same key.
 */
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(LEGAL_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupeKey(lead) {
  return normalizeUrl(lead.website) || normalizeName(lead.name);
}
