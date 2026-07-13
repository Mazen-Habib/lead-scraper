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

export function dedupeKey(lead) {
  return normalizeUrl(lead.website) || (lead.name ? lead.name.trim().toLowerCase() : '');
}
