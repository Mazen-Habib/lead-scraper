// Crawlee engine adapter — a third fetch option alongside the plain fetch()
// used by normal_scraper scrapers and cloakEngine.js's stealth Playwright
// session. Not wired into any existing scraper: cloakEngine already handles
// the anti-bot directories (Clutch, GoodFirms) and plain fetch works fine for
// the rest (GitHub API, PSEB, TopDevelopers). This exists so a *new* scraper
// can opt into Crawlee's built-in retry/proxy-rotation/fingerprint handling
// by setting `"engine": "crawlee_cheerio"` or `"engine": "crawlee_browser"`
// in config.json, without anyone having to rewrite the request-queue-based
// architecture Crawlee normally expects — these wrappers expose a single-URL
// fetch call that matches the shape every existing scraper already uses
// (fetch a page, get HTML back, parse with cheerio).
//
// Both functions return HTML (or null on failure) and never throw — same
// contract as fetchHtmlViaScrapling in scraplingEngine.js.
import { CheerioCrawler, PlaywrightCrawler } from 'crawlee';

/**
 * Fetches a single URL's HTML via Crawlee's CheerioCrawler (fast, no browser,
 * built-in retries + fingerprint-aware headers). Use for static/SSR pages
 * that plain fetch() is getting blocked on.
 */
export async function fetchWithCrawlee(url, { timeoutSecs = 20, maxRetries = 2 } = {}) {
  let html = null;
  try {
    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: 1,
      requestHandlerTimeoutSecs: timeoutSecs,
      maxRequestRetries: maxRetries,
      async requestHandler({ body }) {
        html = typeof body === 'string' ? body : body?.toString('utf8') || null;
      },
      failedRequestHandler() {
        html = null;
      },
    });
    await crawler.run([url]);
  } catch {
    return null;
  }
  return html;
}

/**
 * Fetches a single URL's rendered HTML via Crawlee's PlaywrightCrawler
 * (full browser, JS execution). Use for JS-heavy pages where CheerioCrawler
 * comes back empty but a full cloakEngine session is overkill for a one-off.
 */
export async function fetchRenderedWithCrawlee(url, { timeoutSecs = 30, maxRetries = 1 } = {}) {
  let html = null;
  try {
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      requestHandlerTimeoutSecs: timeoutSecs,
      maxRequestRetries: maxRetries,
      async requestHandler({ page }) {
        html = await page.content();
      },
      failedRequestHandler() {
        html = null;
      },
    });
    await crawler.run([url]);
  } catch {
    return null;
  }
  return html;
}
