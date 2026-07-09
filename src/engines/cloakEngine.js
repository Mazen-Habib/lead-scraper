/**
 * CloakBrowser engine wrapper.
 * Launches the stealth Chromium binary used for anti-bot-protected sources
 * (Clutch, GoodFirms). Same Playwright API as the normal engine, so scrapers
 * written against it look identical to the Google Maps scraper.
 */
import { launch } from 'cloakbrowser';

/**
 * Opens a CloakBrowser page.
 * @param {object} cloak - config.cloak: { headless, humanize, proxy }
 * @returns {{ browser, page }}
 */
export async function openCloakPage(cloak = {}) {
  const opts = {
    headless: cloak.headless !== false,
    humanize: cloak.humanize !== false,
  };
  if (cloak.proxy) opts.proxy = cloak.proxy;
  if (cloak.proxy && cloak.geoip !== false) opts.geoip = true;

  const browser = await launch(opts);
  const page = await browser.newPage();
  return { browser, page };
}
