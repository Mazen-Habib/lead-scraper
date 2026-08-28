// DuckDuckGo discovery source (roadmap Phase A2): searches DDG's plain-HTML
// endpoint (no JS, no login, tolerant of scraping — the same endpoint
// directorySearch.js already relies on for firm-name resolution) for a
// query like "marketing agencies in Lahore" and returns candidate company
// websites. Unlike directorySearch.js, this isn't restricted to known
// directories — it's meant to surface companies with no B2B-directory
// presence at all, especially for regions/verticals those directories cover
// thinly (see PROJECT_CONTEXT.md's Pakistan/local-market gap).
//
// Leads returned here carry only { name, website } — no email/phone/rating.
// The rest of the pipeline already knows what to do with that: enrichLeads()
// (emailFinder.js) crawls the site for contact info exactly as it does for
// every other source's leads.
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Aggregators/social/wiki/search-engine domains that are never a company's
// own site — no point queuing them for enrichLeads() to crawl (a Wikipedia
// page has no /contact page with a business's email on it).
//
// Also excludes the B2B directory sites this codebase already has dedicated,
// per-listing parsers for (Clutch, GoodFirms, Sortlist, DesignRush,
// TechBehemoths, SelectedFirms, TopDevelopers). Verified live: a query like
// "marketing agencies in Lahore" surfaces these directories' own *category/
// listing* pages as top results (e.g. sortlist.com/l/lahore-punjab-pk), not
// an individual company's page within them — crawling that as "a lead" would
// pull the directory's own contact info, not a real company's. The dedicated
// scrapers already extract per-company data from these sites correctly;
// there's nothing this discovery source can usefully add from them.
const JUNK_HOSTS_RE =
  /(^|\.)(facebook|linkedin|twitter|x|instagram|youtube|tiktok|pinterest|wikipedia|google|bing|duckduckgo|yelp|yellowpages|indeed|glassdoor|tripadvisor|reddit|quora|medium|amazon|clutch|goodfirms|sortlist|designrush|techbehemoths|selectedfirms|topdevelopers|ahrefs)\.(com|co)$|wikipedia\.org$/i;

function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Strips DDG's own boilerplate suffix off a result title
// ("Acme Corp - Software Development Company" -> "Acme Corp") when a clear
// separator is present; leaves the title as-is otherwise (better to keep a
// noisy name than guess wrong and cut a real one-word/two-word company name in half).
function cleanResultTitle(title) {
  const t = (title || '').trim();
  const parts = t.split(/\s[-|–]\s/);
  return parts.length > 1 ? parts[0].trim() : t;
}

async function fetchHtml(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Searches DuckDuckGo's HTML endpoint for `query` and returns candidate
 * company leads: [{ name, website }].
 *
 * maxResults: across all pages combined (DDG returns ~25-30 results/page via
 * the `s=` offset param). Paginates only as far as needed to reach maxResults.
 */
export async function scrapeDuckDuckGo(query, maxResults = 30) {
  const leads = [];
  const seenHosts = new Set();
  let offset = 0;

  while (leads.length < maxResults) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${offset ? `&s=${offset}` : ''}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.warn(`  ! DuckDuckGo "${query}" (offset ${offset}): ${err.message}`);
      break;
    }

    const $ = cheerio.load(html);
    const results = $('a.result__a');
    if (results.length === 0) break; // no more pages

    results.each((_, el) => {
      if (leads.length >= maxResults) return false;
      let href = $(el).attr('href') || '';
      // DDG's HTML endpoint wraps result links in a redirect: /l/?uddg=<encoded>
      const m = href.match(/uddg=([^&]+)/);
      if (m) href = decodeURIComponent(m[1]);

      const host = hostOf(href);
      if (!host || JUNK_HOSTS_RE.test(host) || seenHosts.has(host)) return;
      seenHosts.add(host);

      leads.push({
        name: cleanResultTitle($(el).text()),
        website: href.split('?')[0],
        category: '',
      });
    });

    offset += 30;
    await sleep(1200); // polite delay between paginated requests
  }

  return leads;
}
