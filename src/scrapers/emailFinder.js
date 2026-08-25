import * as cheerio from 'cheerio';
import { cleanEmail } from '../lib/cleanLead.js';
import { curlFetchText } from '../lib/curlImpersonate.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
// Paths most likely to expose a contact email during a bulk (thousands-of-leads) run
const CANDIDATE_PATHS = ['', '/contact', '/about'];
// Extra paths worth the time for a single deliberate on-demand lookup (2.1)
const DEEP_CANDIDATE_PATHS = ['/team', '/about-us', '/leadership', '/contact-us', '/company'];
// Junk matches that regex picks up from asset filenames / trackers
const JUNK_PATTERNS =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.(com|org)|@2x|@3x|^(xxx|email|name|user|your|test|firstname|lastname)@|@(xxx|domain|yourdomain|yoursite|sentry|example)\.|placeholder/i;

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
 * Returns { emails: [...], linkedin: '', facebook: '', instagram: '' }
 *
 * opts:
 *   deep      - bulk runs use a thin 3-path/6s-timeout crawl; a deliberate
 *               single-company lookup (src/commands/scrapeUrl.js) sets this
 *               to true for extra paths, footer-link discovery, and a longer timeout.
 *   timeoutMs - per-page fetch timeout (default 6000, deep default 30000)
 */
export async function findContacts(website, opts = {}) {
  const { deep = false, timeoutMs = deep ? 30000 : 6000 } = opts;
  const contacts = { emails: new Set(), linkedin: '', facebook: '', instagram: '' };
  let origin;
  try {
    origin = new URL(website).origin;
  } catch {
    return { emails: [], linkedin: '', facebook: '', instagram: '' };
  }

  const queue = [...CANDIDATE_PATHS, ...(deep ? DEEP_CANDIDATE_PATHS : [])];
  const queued = new Set(queue);
  let footerChecked = false;

  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    // Stop early once we have an email and a LinkedIn link
    if (contacts.emails.size > 0 && contacts.linkedin) break;

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

    // Deep mode only: on the homepage, queue any footer links to contact/
    // about/team pages the fixed candidate list didn't already cover.
    if (deep && path === '' && !footerChecked) {
      footerChecked = true;
      queue.push(...discoverFooterPaths($, origin, queued));
    }
  }

  return {
    emails: [...contacts.emails].slice(0, 3),
    linkedin: contacts.linkedin,
    facebook: contacts.facebook,
    instagram: contacts.instagram,
  };
}

/**
 * Runs findContacts over many leads with limited concurrency.
 *
 * Skips a lead that already has both an email AND a linkedin — the same
 * "we have everything we came for" condition findContacts itself uses to stop
 * crawling a single site early (see the `emails.size > 0 && linkedin` check
 * above). Previously this filtered on `l.website` alone, so a lead already
 * fully known — most often a re-scraped duplicate whose email/linkedin were
 * backfilled from the existing Supabase record before this ran (see
 * runPipeline.js's `knownByKey` option) — still paid for a full site crawl to
 * find information it already had. Measured on a real run: this was ~18% of
 * total wall-clock time on a batch where ~88% of scraped leads were already
 * known.
 */
export async function enrichLeads(leads, concurrency = 15) {
  const queue = leads.filter((l) => l.website && !(l.email && l.linkedin));
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      try {
        const c = await findContacts(lead.website);
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
