/**
 * OLX Pakistan — Services category (olx.com.pk/services_c619 and its
 * subcategories: consultancy, construction, events, car services, tailors,
 * insurance). The one "OLX-style classifieds" source the architecture plan
 * recommended, chosen and verified live before writing this, not guessed:
 * robots.txt allows crawling category/item pages (only /api/, /post/,
 * /profile/, and filter-query paths are disallowed), and a real item page
 * was checked directly.
 *
 * A real, load-bearing limitation, found during that check, not assumed:
 * OLX does NOT expose a seller's phone number to a plain page fetch — it's
 * neither in the page's JSON-LD (seller is anonymized as "OLX user") nor in
 * any embedded data blob, only behind a "Contact Now" reveal action. This
 * scraper does not attempt to reverse-engineer that reveal call — deliberately,
 * both because it's more fragile than a real API and because a phone number
 * a seller has chosen to gate behind a click is a different privacy posture
 * than one printed directly on a business directory listing. What IS
 * genuinely available: title, category, city, and free-text description —
 * which sometimes contains a website or email (occasionally obfuscated,
 * e.g. "tax. msft. pk" seen live), recovered via the same
 * emailDeobfuscate.js this session already built for emailFinder.js.
 */
import * as cheerio from 'cheerio';
import { cleanEmail, cleanStr } from '../lib/cleanLead.js';
import { deobfuscateEmails } from '../lib/emailDeobfuscate.js';
import { GEO } from '../quality/geography.js';
import { createPacer } from '../lib/jinaReader.js';

const BASE = 'https://www.olx.com.pk';
// robots.txt doesn't set a Crawl-delay, but nothing here needs to move fast
// either — one request per second is plenty polite for a live consumer site
// (unlike businesslist.pk/ng, which have their own documented per-domain
// delays already).
const pace = createPacer(1000);
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
// A website mention in free text is often written with spaces around dots to
// dodge naive scrapers/spam filters ("tax. msft. pk") — this collapses that
// specific shape back into a real domain before the plain URL_RE pass runs.
const SPACED_DOMAIN_RE = /\b([a-z0-9-]+)\.\s+([a-z0-9-]+)\.\s+(pk|com|net|org|co)\b/gi;
const URL_RE = /https?:\/\/[^\s)"'<>]+|(?:[a-z0-9-]+\.)+(?:com|pk|net|org|co)(?:\.pk)?\b/gi;

// Tracking pixels sitting in every single page's raw HTML (GTM's noscript
// iframe, GA, Facebook's pixel) matched URL_RE just as readily as a real
// business site — caught by running this against real live pages, not
// assumed. None of these are ever the lead's own site.
const NON_BUSINESS_URL_HOSTS = [
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
  'googlesyndication.com', 'gstatic.com', 'cloudflareinsights.com',
  'facebook.com', 'olx.com',
];
function isTrackingOrSelfUrl(url) {
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return NON_BUSINESS_URL_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true; // unparsable "URL" is junk either way
  }
}

// City names are matched against the same list geography.js already
// maintains (shared/geo.json) rather than a page-specific CSS selector —
// OLX's location text sits in a build-tool hash-generated class
// (e.g. "_948d9e0a") with no stable semantic hook, confirmed by inspecting
// a real live page; a class name like that can change on OLX's next
// deploy, but the set of real city names won't.
const CITY_LABELS = GEO.countries.flatMap((c) => c.cities.map((city) => city.label));
function findCityInText(text) {
  for (const label of CITY_LABELS) {
    if (new RegExp(`\\b${label}\\b`, 'i').test(text)) return label;
  }
  return '';
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractWebsiteFromText(rawText) {
  const normalized = rawText.replace(SPACED_DOMAIN_RE, '$1.$2.$3');
  const matches = normalized.match(URL_RE) || [];
  for (const m of matches) {
    if (isTrackingOrSelfUrl(m)) continue;
    return m.startsWith('http') ? m : `https://${m}`;
  }
  return '';
}

function extractEmailFromText(rawText, $) {
  const plain = (rawText.match(EMAIL_RE) || []).map(cleanEmail).filter(Boolean);
  if (plain.length > 0) return plain[0];
  const deobfuscated = deobfuscateEmails(rawText, $);
  return deobfuscated[0] || '';
}

/**
 * Scrapes one OLX Services (sub)category by slug, e.g. "consultancy-services_c707005".
 * Returns raw leads in the standard shape (name/category/website/email/address/maps_url).
 */
export async function scrapeOlx(categorySlug, opts = {}) {
  const maxListings = opts.maxListings || 15;
  let listHtml;
  try {
    listHtml = await fetchHtml(`${BASE}/${categorySlug}`);
  } catch (err) {
    console.warn(`  !! OLX: category page failed (${categorySlug}): ${err.message}`);
    return [];
  }

  const $list = cheerio.load(listHtml);
  const itemPaths = [];
  const seen = new Set();
  $list('a[href*="/item/"]').each((_, el) => {
    const href = $list(el).attr('href') || '';
    const path = href.startsWith('http') ? new URL(href).pathname : href;
    if (seen.has(path)) return;
    seen.add(path);
    itemPaths.push(path);
  });

  const leads = [];
  for (const path of itemPaths.slice(0, maxListings)) {
    await pace();
    let html;
    try {
      html = await fetchHtml(`${BASE}${path}`);
    } catch {
      continue;
    }
    const $ = cheerio.load(html);
    const title = cleanStr($('h1').first().text());
    if (!title) continue;

    const city = findCityInText($('body').text());

    // OLX's build tool generates hash class names ("_5eb397e5") with no
    // stable semantic hook (confirmed on a real live page) — so instead of
    // depending on a class name that can change on OLX's next deploy, find
    // the element whose own text is literally "Description" and read its
    // DOM sibling. Scanning only this block (not the whole page body) is
    // also what fixed the tracking-pixel bug below: the full body text
    // includes GTM/GA script tags, which matched the website regex just as
    // easily as a real link.
    const descHeading = $('*')
      .filter((_, el) => $(el).children().length === 0 && $(el).text().trim() === 'Description')
      .first();
    const descriptionText = descHeading.length ? descHeading.next().text() : '';

    leads.push({
      name: title,
      category: categorySlug.replace(/_c\d+$/, '').replace(/-/g, ' '),
      website: extractWebsiteFromText(descriptionText),
      email: extractEmailFromText(descriptionText, $),
      address: city,
      maps_url: `${BASE}${path}`,
    });
  }
  return leads;
}
