import * as cheerio from 'cheerio';
import { cleanEmail, cleanStr, cleanPhone, isRoleInbox } from '../lib/cleanLead.js';
import { curlFetchText } from '../lib/curlImpersonate.js';
import { GEO, REGIONS, resolveGeo } from '../quality/geography.js';
import { extractPhoneNumbers, resolveDefaultCountryIso2 } from '../lib/phoneExtract.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
// Paths most likely to expose a contact email during a bulk (thousands-of-leads) run
const CANDIDATE_PATHS = ['', '/contact', '/about'];
// Extra paths worth the time for a single deliberate on-demand lookup (2.1)
const DEEP_CANDIDATE_PATHS = ['/team', '/about-us', '/leadership', '/contact-us', '/company'];
// Junk matches that regex picks up from asset filenames / trackers
const JUNK_PATTERNS =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.(com|org)|@2x|@3x|^(xxx|email|name|user|your|test|firstname|lastname)@|@(xxx|domain|yourdomain|yoursite|sentry|example)\.|placeholder/i;

// A parked/misconfigured/template page (200 OK, but the body is stock
// placeholder content, not the real business's site) — a real production hit
// was "Ava Thompson, Founder and Yoga Instructor" pulled off a sandwich
// bar's <title>Access Forbidden</title> page whose meta description was
// still "Webpage description goes here". Nothing on a page like this is a
// trustworthy signal for a decision-maker, however name-shaped it looks.
const PAGE_JUNK_RE =
  /webpage description goes here|lorem ipsum|access forbidden|403 forbidden|under construction|coming soon|domain (is )?for sale|this site can.?t be reached/i;

// A person's full name, e.g. "John Smith" or "Mary Jane Watson" — 2-3
// capitalized words, nothing else on the line.
const NAME_RE = /^[A-Z][a-zA-Z'.-]+(?:\s[A-Z][a-zA-Z'.-]+){1,2}$/;

// Section headings ("Meet Our Team", "Our Leadership") and unrelated service
// copy ("Business Immigration Advice") match NAME_RE just as easily as a real
// name — both are 2-3 capitalized words. None of these words legitimately
// appear in a person's name, so they're a safe reject list.
const NAME_BLOCKLIST_RE =
  /\b(Team|Leadership|Staff|Members?|Management|Meet|Our|About|Company|Group|Services?|Advice|Business|Contact|Careers|Visa|Immigration|Department|Office|Manager|Officer|Executive|Operations?|Production|Coordinator|Supervisor|Administrator|Representative|Specialist|Engineer|Consultant|Analyst|Associate|Assistant|Partner|Official|Certified|Admin|Panel|Dashboard|Login)\b/i;

// Placeholder names used in templates/examples — never a real contact.
// "John Smith"/"Jane Smith" are deliberately NOT here: unlike "(John|Jane)
// Doe", they're common enough as real names that blocking them would cost
// more true positives than the rare placeholder use would save.
const PLACEHOLDER_NAME_RE =
  /^(john|jane)\s+doe$|^test\s+test$|^foo\s+bar$|^your\s+name$|^full\s+name$|^first\s+last$/i;

// Place names ("United States", "Karachi", "Middle East") match the name
// shape just as easily as a person — reuse the same country/city/region
// label lists geography.js resolves leads against, rather than authoring a
// second location list to keep in sync.
const PLACE_NAMES = new Set(
  [
    ...GEO.countries.map((c) => c.label),
    ...GEO.countries.flatMap((c) => c.cities.map((city) => city.label)),
    ...REGIONS.regions.map((r) => r.label),
  ].map((s) => s.toLowerCase())
);

// Tech/business generic terms ("Rapid MVP Development", "Retail ERP") that
// end up in the name slot when the DOM heuristic grabs service copy or a
// product name sitting next to a title-shaped phrase, instead of a person.
const GENERIC_BUSINESS_NAME_RE =
  /\b(Development|Solutions?|Software|Systems?|Technolog(?:y|ies)|Digital|Cloud|Consulting|Platform|MVP|ERP|CRM|SaaS|API|App|Apps)\b/i;

// Job titles that identify a decision-maker, ranked by how senior/authoritative
// they are — tier 1 wins over tier 2 when a page lists several people.
const TITLE_TIERS = [
  /\b(Founder|Co-Founder|CEO|Chief Executive Officer|President|Owner|Managing Director|Managing Partner)\b/i,
  /\b(CTO|COO|CFO|CMO|Chief [A-Za-z]+ Officer|VP|Vice President|Partner|Principal|Director)\b/i,
  /\b(Head of [A-Za-z &]+|Manager)\b/i,
];

// Catches the testimonial-caption shape ORG_SUFFIX_RE misses: a bare company
// name with no legal-entity suffix ("COO/Founder, Omnidian", "VP at Bennie",
// "CEO - Easyfill", "CEO | Digital Transformation" — none of those company
// names contain a word like Inc/LLC/Solutions). The general tell is
// structural, not lexical: whatever follows a comma/"at"/"-"/"|" in a genuine
// title is itself another role phrase ("CEO, Co-Founder") or a short
// qualifier — never a proper-noun organization name. Deliberately excludes
// "of" as a split point: TITLE_TIERS' own "Head of Marketing" pattern uses
// it, so splitting there would reject a genuine title ("Manager of X"
// testimonials slip through as a result — a known, accepted gap).
// Checked in isolation per split part so one bad trailing part (a company
// name) can't hide behind an earlier legitimate one (a role).
const TITLE_PART_SPLIT_RE = /,|\bat\b|\bin\b|\s[-–•]\s|\||\.\s+/i;
function hasNonTitlePart(text) {
  const parts = text.split(TITLE_PART_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.slice(1).some((part) => part.length > 3 && !TITLE_TIERS.some((re) => re.test(part)));
}

function classifyTitle(text) {
  if (ORG_SUFFIX_RE.test(text) || hasNonTitlePart(text) || DOMAIN_LIKE_RE.test(text)) return 0;
  for (let i = 0; i < TITLE_TIERS.length; i++) {
    if (TITLE_TIERS[i].test(text)) return i + 1;
  }
  return 0;
}

// Junk checks shared by both extraction paths (DOM heuristic + JSON-LD) —
// things that are never a real person's name regardless of which path found
// text shaped like one.
function isJunkName(t) {
  if (NAME_BLOCKLIST_RE.test(t)) return true;
  if (PLACEHOLDER_NAME_RE.test(t)) return true;
  if (GENERIC_BUSINESS_NAME_RE.test(t)) return true;
  if (PLACE_NAMES.has(t.toLowerCase())) return true;
  // A company name ("Meridian Labs Inc.") can end up in the name slot the
  // same way it ends up in the title slot — same org-suffix tell applies.
  if (ORG_SUFFIX_RE.test(t)) return true;
  // A real name in page markup is essentially never written fully upper-case
  // ("ZEN-Y ICT SOLUTIONS") — that shape belongs to a company/brand name or
  // acronym-heavy heading, not a person, even though it still fits NAME_RE.
  if (t === t.toUpperCase() && t !== t.toLowerCase()) return true;
  return false;
}

function looksLikeName(text) {
  const t = (text || '').trim();
  if (!t || t.length > 40) return false;
  if (!NAME_RE.test(t)) return false;
  return !isJunkName(t);
}

// Testimonial/partner-mention captions read "Role, Some Other Company" or
// "Role Some Other Company Name" — a shape a genuine team-page title never
// has ("CEO", "Founder & CEO"). Real hits from production: "CEO, Bataib
// Establishment", "Owner, The Paro Consulting Group", "Information Systems
// Director, Groupe IMA" — all quoting a client/partner, not the site's own
// team, on pages with no other tell (no quote marks, not a link). A genuine
// title essentially never contains a company-suffix word like these.
const ORG_SUFFIX_RE =
  /\b(Establishment|Group|Groupe|Consulting|Systems?|International|Portfolio|Solutions?|Technolog(?:y|ies)|Inc\.?|LLC|Ltd\.?|Limited|Corp\.?|Company|Enterprises?|Holdings?|Partners|Associates|Institute)\b/i;

// A "word.tld"-shaped token ("Raccoon.World", "DrinkUp.London") is a company
// name/domain slipped into a title with no separator at all for
// hasNonTitlePart to split on — the "CEO Acme.io" shape a testimonial
// caption takes when its template has no comma between role and company.
const DOMAIN_LIKE_RE = /\b[a-z0-9-]{2,}\.(com|net|org|io|co|world|london|studio|agency|app|dev)\b/i;

// Walks parsed JSON-LD (schema.org) looking for `Person` nodes with both a
// name and a jobTitle — the highest-confidence signal a site can give us,
// since it's structured data the site itself published for search engines.
function walkForPersons(node, candidates, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  if (node['@type'] === 'Person' && node.name && node.jobTitle) {
    const name = String(node.name).trim();
    const jobTitle = String(node.jobTitle);
    // classifyTitle already rejects an org-suffix-shaped title (tier 0), but
    // the `|| 4` fallback below exists for a jobTitle that's simply not one
    // of TITLE_TIERS' known phrases — don't let that fallback silently
    // un-reject an org-suffix title that classifyTitle correctly flagged.
    if (!isJunkName(name) && !ORG_SUFFIX_RE.test(jobTitle)) {
      const tier = classifyTitle(jobTitle) || 4;
      candidates.push({ name, title: jobTitle, tier });
    }
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) val.forEach((v) => walkForPersons(v, candidates, depth + 1));
    else if (val && typeof val === 'object') walkForPersons(val, candidates, depth + 1);
  }
}

function extractFromJsonLd($) {
  const candidates = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    for (const item of Array.isArray(data) ? data : [data]) walkForPersons(item, candidates);
  });
  return candidates;
}

// Heuristic fallback for sites without JSON-LD: finds short elements whose
// text is just a job title (e.g. "CEO & Founder") and looks for a name-shaped
// sibling near it — the common "team member card" pattern (name heading,
// title directly below/after it).
//
// The same card shape shows up in client-testimonial widgets ("Jane Doe,
// Founder, Acme Co" under a quoted review) — a false positive that would
// attribute someone else's customer as the company's own decision-maker.
// Testimonial text reliably contains a quoted sentence nearby even when
// there's no semantic class name to key off (component-library markup tends
// to use utility classes, not "testimonial"), so a curly-quote/quoted-run
// check in the surrounding container is a more reliable discriminator than
// class names here.
const QUOTE_NEARBY_RE = /[“”]|"[^"]{20,}"/;

function nearbyTextHasQuote($el) {
  let node = $el;
  for (let i = 0; i < 4 && node.length; i++) node = node.parent();
  return QUOTE_NEARBY_RE.test(node.text());
}

// Nav/footer link text ("Partner Login", "Become a Partner") matches the
// name and title shapes just as easily as a real person does — the only
// reliable tell is that it's link text, not prose. Reject any candidate
// piece (title or name) whose visible text is entirely a link's text,
// whether the element itself is the <a> (or inside one, e.g. a caption
// under a linked image) or just wraps one (e.g. <h6><a>Partner Login</a></h6>).
function isLinkText($el) {
  if ($el.is('a') || $el.closest('a').length > 0) return true;
  const innerLinkText = $el.find('a').text().trim();
  return innerLinkText.length > 0 && innerLinkText === $el.text().trim();
}

function extractFromDom($) {
  const candidates = [];
  $('h1,h2,h3,h4,h5,h6,strong,b,span,p,div').each((_, el) => {
    const text = $(el).text().trim();
    if (!text || text.length > 60) return;
    const tier = classifyTitle(text);
    if (!tier) return;
    if (text.split(/\s+/).length > 6) return; // avoid matching full sentences

    const $el = $(el);
    if (isLinkText($el)) return;
    if (nearbyTextHasQuote($el)) return; // likely a testimonial card, not our team

    let name = '';
    if (looksLikeName($el.prev().text()) && !isLinkText($el.prev())) {
      name = $el.prev().text().trim();
    } else if (looksLikeName($el.parent().prev().text()) && !isLinkText($el.parent().prev())) {
      name = $el.parent().prev().text().trim();
    } else {
      $el
        .parent()
        .children()
        .each((_, sib) => {
          if (sib === el) return false; // stop once we reach the title element itself
          const $sib = $(sib);
          if (looksLikeName($sib.text()) && !isLinkText($sib)) name = $sib.text().trim();
        });
    }
    if (name) candidates.push({ name, title: text, tier });
  });
  return candidates;
}

// Picks the most senior named decision-maker found on a page, from
// already-parsed JSON-LD + DOM heuristics — no extra network calls, so this
// is free on every page findContacts() was already going to fetch.
function extractDecisionMaker($) {
  const candidates = [...extractFromJsonLd($), ...extractFromDom($)];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.tier - b.tier);
  return { name: cleanStr(candidates[0].name), title: cleanStr(candidates[0].title) };
}

async function fetchPage(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) throw new Error(`Not HTML: ${type}`);
    return await res.text();
  } catch (err) {
    // Fallback: the block may be TLS/HTTP2 fingerprinting (Node's fetch()
    // handshake doesn't look like a real browser's). curl-impersonate makes
    // the same request with a genuine Chrome handshake. No-op if the binary
    // isn't installed — rethrows the original error so the caller's existing
    // "skip this path" behavior is unchanged.
    const html = curlFetchText(url, { timeoutMs });
    if (html) return html;
    throw err;
  }
}

// Pulls internal links out of a page's <footer> that look like contact/about/team
// pages we haven't already queued — footers are where smaller sites often hide
// their only links to those pages instead of a nav menu.
function discoverFooterPaths($, origin, alreadyQueued) {
  const found = [];
  $('footer a[href], [class*="footer"] a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    let path;
    try {
      path = new URL(href, origin).pathname;
    } catch {
      return;
    }
    if (!/(contact|about|team|leadership|company)/i.test(path)) return;
    if (alreadyQueued.has(path)) return;
    found.push(path);
    alreadyQueued.add(path);
  });
  return found;
}

/**
 * Crawls a company website's homepage + contact pages for emails/socials.
 * Returns { emails: [...], linkedin: '', facebook: '', instagram: '', phone: '' }
 *
 * opts:
 *   deep              - bulk runs use a thin 3-path/6s-timeout crawl; a deliberate
 *                        single-company lookup (src/commands/scrapeUrl.js) sets this
 *                        to true for extra paths, footer-link discovery, and a longer timeout.
 *   timeoutMs         - per-page fetch timeout (default 6000, deep default 30000)
 *   defaultCountryIso2 - ISO 3166-1 alpha-2 hint (e.g. "PK") for resolving bare
 *                        local-format phone numbers — see src/lib/phoneExtract.js.
 */
export async function findContacts(website, opts = {}) {
  const { deep = false, timeoutMs = deep ? 30000 : 6000, defaultCountryIso2 } = opts;
  const contacts = {
    emails: new Set(),
    linkedin: '',
    facebook: '',
    instagram: '',
    contactName: '',
    contactTitle: '',
    phone: '',
  };
  let origin;
  try {
    origin = new URL(website).origin;
  } catch {
    return { emails: [], linkedin: '', facebook: '', instagram: '', contactName: '', contactTitle: '', phone: '' };
  }

  const queue = [...CANDIDATE_PATHS, ...(deep ? DEEP_CANDIDATE_PATHS : [])];
  const queued = new Set(queue);
  let footerChecked = false;

  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    // Stop early once we have a REAL PERSON'S email (or at least a named
    // contact) and a LinkedIn link — not just "an email, any email". The old
    // condition (`emails.size > 0`) stopped the moment it found info@/sales@
    // on the homepage, which is where a role inbox usually lives, so the
    // crawl never reached /team or /leadership — exactly the pages a named
    // person's email would be on. Measured before this fix: 61% of leads
    // with an email had only a role inbox (scripts/audit-leads.js). This is
    // a deliberate tradeoff toward more requests per lead when the homepage
    // is role-inbox-only, in exchange for actually finding the person.
    const hasPersonalEmail = [...contacts.emails].some((e) => !isRoleInbox(e));
    if ((hasPersonalEmail || contacts.contactName) && contacts.linkedin) break;

    let html;
    try {
      html = await fetchPage(origin + path, timeoutMs);
    } catch {
      continue;
    }

    const $ = cheerio.load(html);

    // mailto: links are the most reliable signal
    $('a[href^="mailto:"]').each((_, el) => {
      const raw = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0];
      const email = cleanEmail(raw); // decodes %20info@ → info@, strips HTML, validates
      if (email && !JUNK_PATTERNS.test(email)) contacts.emails.add(email);
    });

    // Fall back to regex over visible text + raw HTML
    const matches = html.match(EMAIL_RE) || [];
    for (const m of matches) {
      const email = cleanEmail(m); // normalise before adding
      if (email && !JUNK_PATTERNS.test(email)) contacts.emails.add(email);
    }

    // tel: links are the phone equivalent of mailto: — highest-confidence signal
    if (!contacts.phone) {
      const telHref = $('a[href^="tel:"]').first().attr('href');
      if (telHref) {
        const [validated] = extractPhoneNumbers(telHref.replace(/^tel:/i, ''), defaultCountryIso2);
        if (validated) contacts.phone = validated;
      }
    }
    // Fall back to scanning visible text for a valid phone number
    if (!contacts.phone) {
      const [validated] = extractPhoneNumbers($.text(), defaultCountryIso2);
      if (validated) contacts.phone = validated;
    }

    // Social profiles (LinkedIn is the valuable one for B2B scoring)
    if (!contacts.linkedin) {
      const li = $('a[href*="linkedin.com/"]').first().attr('href');
      if (li) contacts.linkedin = li.split('?')[0];
    }
    if (!contacts.facebook) {
      const fb = $('a[href*="facebook.com/"]').first().attr('href');
      if (fb) contacts.facebook = fb.split('?')[0];
    }
    if (!contacts.instagram) {
      const ig = $('a[href*="instagram.com/"]').first().attr('href');
      if (ig) contacts.instagram = ig.split('?')[0];
    }

    // Named decision-maker (about/team/leadership pages) — same fetched
    // page, no extra request. Keep the first (most senior) one found.
    // Skipped entirely on a parked/placeholder page — see PAGE_JUNK_RE.
    if (!contacts.contactName && !PAGE_JUNK_RE.test(html)) {
      const person = extractDecisionMaker($);
      if (person) {
        contacts.contactName = person.name;
        contacts.contactTitle = person.title;
      }
    }

    // Deep mode only: on the homepage, queue any footer links to contact/
    // about/team pages the fixed candidate list didn't already cover.
    if (deep && path === '' && !footerChecked) {
      footerChecked = true;
      queue.push(...discoverFooterPaths($, origin, queued));
    }
  }

  // A real person's email first, even if a role inbox was technically found
  // earlier in the crawl (e.g. info@ sitting in the homepage footer, found
  // before /team's sarah@company.com) — this is what actually makes
  // lead.email = c.emails[0] pick the person instead of the reception desk.
  const orderedEmails = [...contacts.emails].sort(
    (a, b) => Number(isRoleInbox(a)) - Number(isRoleInbox(b))
  );

  return {
    emails: orderedEmails.slice(0, 3),
    linkedin: contacts.linkedin,
    facebook: contacts.facebook,
    instagram: contacts.instagram,
    contactName: contacts.contactName,
    contactTitle: contacts.contactTitle,
    phone: contacts.phone,
  };
}

/**
 * Runs findContacts over many leads with limited concurrency.
 *
 * Skips a lead that already has an email, a linkedin, AND a contact_name —
 * "we have everything we came for". Previously this filtered on email+linkedin
 * alone, so a lead already fully known — most often a re-scraped duplicate
 * whose fields were backfilled from the existing Supabase record before this
 * ran (see runPipeline.js's `knownByKey` option) — still paid for a full site
 * crawl to find information it already had. Measured on a real run: this was
 * ~18% of total wall-clock time on a batch where ~88% of scraped leads were
 * already known.
 *
 * contact_name has to be part of that "fully known" bar, not just email+
 * linkedin: a source scraper (e.g. PSEB) commonly hands over its own role
 * inbox (info@...) and a company LinkedIn directly, which used to satisfy the
 * old two-field check and skip the crawl entirely — meaning the free
 * decision-maker extraction below never got a chance to run on exactly the
 * leads it exists to fix. A genuinely-known duplicate isn't penalized by this:
 * backfillFromKnown() (runPipeline.js) copies contact_name from the Supabase
 * master the same way it does every other field, so once a lead has been
 * crawled once and a name found, later re-scrapes still skip it.
 */
export async function enrichLeads(leads, concurrency = 15) {
  const queue = leads.filter((l) => l.website && !(l.email && l.linkedin && l.contact_name));
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      try {
        // Country hint for resolving bare local-format phone numbers
        // ("0300-1234567") — cheap, pure keyword match against address/
        // search_query the scraper already populated (see geography.js);
        // doesn't require resolveRegions() to have run yet.
        const { country } = resolveGeo(lead);
        const defaultCountryIso2 = resolveDefaultCountryIso2(lead.country || country);
        const c = await findContacts(lead.website, { defaultCountryIso2 });
        // Merge crawler results with scraper-provided values — prefer the
        // crawler's contact page email (more reliable) but never blank-out
        // a field that the original scraper already populated.
        const prevEmail = lead.email || '';
        lead.email = c.emails[0] || prevEmail;
        const emailSet = new Set([...c.emails, ...(prevEmail ? [prevEmail] : [])]);
        lead.all_emails = [...emailSet].filter(Boolean).join('; ');
        lead.linkedin = c.linkedin || lead.linkedin || '';
        lead.facebook = c.facebook || lead.facebook || '';
        lead.instagram = c.instagram || lead.instagram || '';
        lead.contact_name = c.contactName || lead.contact_name || '';
        lead.contact_title = c.contactTitle || lead.contact_title || '';
        // Never overwrite a phone number the source scraper already gave us
        // (e.g. Google Maps' own phone field) — the crawl only fills a gap.
        if (!lead.phone && c.phone) lead.phone = cleanPhone(c.phone);
      } catch {
        /* leave fields as-is on error */
      }
      done++;
      process.stdout.write(`  Enriched ${done} websites...\r`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('');
  return leads;
}
