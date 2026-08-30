/**
 * Centralised field-cleaning utilities.
 * Every string that enters the pipeline from a scraper or web crawl passes
 * through here so the output CSV/DB never contains URL-encoded junk, stray
 * HTML tags, or HTML entity references.
 */

const HTML_ENTITIES = {
  '&amp;':  '&',
  '&lt;':   '<',
  '&gt;':   '>',
  '&quot;': '"',
  '&#39;':  "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&laquo;': '«',
  '&raquo;': '»',
};

function decodeHtmlEntities(str) {
  return str
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g,      (_, d)   => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]+>/g, ' ');
}

function safeDecodeUri(str) {
  try { return decodeURIComponent(str); } catch { return str; }
}

function normalizeWhitespace(str) {
  return str.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cleans a single string value through the full pipeline. */
export function cleanStr(value) {
  if (!value) return '';
  let s = String(value);
  s = safeDecodeUri(s);          // %20info@ → info@
  s = stripHtmlTags(s);          // <br> etc. → space
  s = decodeHtmlEntities(s);     // &amp; → &
  s = normalizeWhitespace(s);    // collapse whitespace
  return s;
}

// Valid email pattern (no spaces, proper structure)
const VALID_EMAIL = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/;

/** Cleans an email address. Returns '' if it cannot be made valid. */
export function cleanEmail(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = safeDecodeUri(s);         // %20info@ → info@
  s = stripHtmlTags(s);
  s = decodeHtmlEntities(s);
  s = s.replace(/\s+/g, '');    // remove any remaining spaces inside
  return VALID_EMAIL.test(s) ? s : '';
}

// Reception desks, not people — deliverable, but nobody's inbox in
// particular. The single source of truth for this check: scripts/audit-leads.js
// used to keep its own separate copy for *measuring* the 61%-role-inbox
// problem, while emailFinder.js had no equivalent check at all and couldn't
// act on it. Both now import this one.
const ROLE_INBOX =
  /^(info|contact|hello|sales|admin|support|office|enquiry|enquiries|inquiry|mail|team|hi|help|general|reception|marketing|careers|jobs|hr|billing|accounts|noreply|no-reply)@/i;

/** True if an email is a generic role inbox rather than a named person's. */
export function isRoleInbox(email) {
  return !!email && ROLE_INBOX.test(email);
}

/** Cleans a phone number: strips HTML, decodes entities, normalises whitespace. */
export function cleanPhone(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = safeDecodeUri(s);
  s = stripHtmlTags(s);
  s = decodeHtmlEntities(s);
  s = normalizeWhitespace(s);
  // Remove obvious placeholder values
  if (/^(\+?0+|n\/?a|none|null|undefined)$/i.test(s)) return '';
  return s;
}

/** Cleans a URL: strips whitespace and HTML artifacts. */
export function cleanUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = stripHtmlTags(s);
  s = decodeHtmlEntities(s);
  s = s.replace(/\s+/g, '');   // URLs never contain spaces
  // Must look like a URL
  try { new URL(s); return s; } catch { return ''; }
}

/**
 * Applies cleaning to every string field of a lead object in-place.
 * Returns the same object (mutates for efficiency in large arrays).
 */
export function cleanLead(lead) {
  const textFields = ['name', 'company_name', 'category', 'address', 'search_query',
                      'engine', 'source', 'company_size', 'hourly_rate', 'min_project',
                      'rating', 'reviews', 'review_count', 'email_verified', 'scraped_at',
                      'tier', 'score', 'contact_name', 'contact_title'];
  for (const f of textFields) {
    if (lead[f]) lead[f] = cleanStr(lead[f]);
  }

  // Email fields — stricter validation
  if (lead.email)      lead.email      = cleanEmail(lead.email);
  if (lead.all_emails) {
    const cleaned = lead.all_emails
      .split(/[;,]/)
      .map((e) => cleanEmail(e.trim()))
      .filter(Boolean);
    // Deduplicate
    lead.all_emails = [...new Set(cleaned)].join('; ');
  }

  // Phone
  if (lead.phone) lead.phone = cleanPhone(lead.phone);

  // URL fields
  for (const f of ['website', 'linkedin', 'facebook', 'instagram', 'maps_url', 'profile_url']) {
    if (lead[f]) lead[f] = cleanUrl(lead[f]) || lead[f].trim();
  }

  return lead;
}
