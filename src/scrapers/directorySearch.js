// Directory-search fallback for firm-name resolution (roadmap 2.2, 3rd hop):
// when Google Maps and GitHub can't place a company, search DuckDuckGo's
// plain-HTML endpoint (no JS, no anti-bot) restricted to the directories this
// scraper already knows how to read (Clutch, GoodFirms, TopDevelopers), then
// pull the outbound "visit website" link off the matched profile page.
import * as cheerio from 'cheerio';

const DIRECTORY_HOSTS = ['clutch.co', 'goodfirms.co', 'topdevelopers.co'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchHtml(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Finds the first plausible "company profile" result on one of the known
// directories for this firm name.
async function searchDirectoryProfile(name) {
  const siteFilter = DIRECTORY_HOSTS.map((h) => `site:${h}`).join(' OR ');
  const q = encodeURIComponent(`${name} (${siteFilter})`);
  const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${q}`);
  const $ = cheerio.load(html);

  let profileUrl = '';
  $('a.result__a, a[href]').each((_, el) => {
    if (profileUrl) return;
    let href = $(el).attr('href') || '';
    // DuckDuckGo's HTML endpoint wraps result links in a redirect
    const m = href.match(/uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    const host = hostOf(href);
    if (DIRECTORY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      profileUrl = href;
    }
  });
  return profileUrl;
}

// Pulls the company's own website off a directory profile page — the
// outbound link that isn't the directory's own domain, mailto, or a social profile.
function extractOutboundWebsite(html, directoryHost) {
  const $ = cheerio.load(html);
  let website = '';
  $('a[href^="http"]').each((_, el) => {
    if (website) return;
    const href = $(el).attr('href');
    const host = hostOf(href);
    if (!host || host === directoryHost || host.endsWith(`.${directoryHost}`)) return;
    if (/linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|google\.com/i.test(host)) return;
    website = href.split('?')[0];
  });
  return website;
}

/**
 * Resolves a firm name to a website by searching known B2B directories.
 * Returns { website, profileUrl, confidence } or null if nothing matched.
 */
export async function resolveViaDirectorySearch(name) {
  const profileUrl = await searchDirectoryProfile(name);
  if (!profileUrl) return null;

  const directoryHost = DIRECTORY_HOSTS.find((h) => hostOf(profileUrl).endsWith(h));
  const html = await fetchHtml(profileUrl);
  const website = extractOutboundWebsite(html, directoryHost);
  if (!website) return null;

  return { website, profileUrl, confidence: 0.5 };
}
