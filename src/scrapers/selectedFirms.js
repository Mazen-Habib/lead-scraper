import * as cheerio from 'cheerio';
import { openCloakPage } from '../engines/cloakEngine.js';
import { fetchHtmlViaScrapling } from '../engines/scraplingEngine.js';

// Pure extraction: HTML string -> leads[]. Shared by the primary cloak_browser
// path (fed page.content()) and the Scrapling stealth-fetch fallback below
// (fed StealthySession's HTML) — same selectors, same output shape either way.
function parseListingHtml($, category) {
  const cards = $('.listing_box_wpr');
  const leads = [];

  cards.each((_, el) => {
    const card = $(el);
    const nameA = card.find('a.website-click').first();
    const name = nameA.text().trim().replace(/\s+/g, ' ');
    const website = (nameA.attr('href') || '').split('?')[0];
    const profile = card.find('a.profile-click').first().attr('href') || '';
    const rating = card.find('.company-rating .bm-text span, .review-text span').first().text().trim();
    const reviews = (card.text().match(/View all\s*(\d+)\s*Reviews?/i) || [])[1] || '';
    const hourlyRate = card.find('.in-point.rate .bm-text').first().text().trim();
    const minProject = card.find('.in-point.purse .bm-text').first().text().trim();
    const companySize = card.find('.in-point.people .bm-text').first().text().trim();
    const address = card.find('.in-point.location .bm-text').first().text().trim();

    if (!name) return;
    leads.push({
      name,
      category: category.replace(/-/g, ' '),
      website,
      email: '',
      phone: '',
      address,
      rating,
      reviews,
      company_size: companySize,
      hourly_rate: hourlyRate,
      min_project: minProject,
      maps_url: profile,
    });
  });

  return { leads, cardCount: cards.length };
}

/**
 * Scrapes a SelectedFirms directory listing
 * (e.g. https://selectedfirms.co/companies/software-development/india).
 * Replaces the earlier "Manifest" source, which turned out to be a London
 * design agency's own site, not a company directory.
 * Website URL is exposed directly in the listing (a.website-click), so no
 * per-profile visit is needed — unlike TechBehemoths.
 *
 * If the cloak_browser session returns zero cards for a page (current anti-bot
 * defenses now block it), falls back to fetching that same URL through
 * Scrapling's StealthySession (src/engines/scraplingEngine.js) and re-parses
 * with the exact same selectors. Disable via config.selectedFirms.scraplingFallback = false.
 */
export async function scrapeSelectedFirms(category, cloak = {}, country = '', maxPages = 2, opts = {}) {
  const { pythonBin = null, scraplingFallback = true } = opts;
  const { browser, page } = await openCloakPage(cloak);
  const leads = [];

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      let base = `https://selectedfirms.co/companies/${category}`;
      if (country) base += `/${country}`;
      const url = pageNum > 1 ? `${base}?page=${pageNum}` : base;

      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      const blocked = resp && resp.status() >= 400;
      if (blocked) {
        console.warn(`  ! SelectedFirms ${url} returned HTTP ${resp.status()}.`);
      }

      let pageLeads = [];
      let cardCount = 0;
      if (!blocked) {
        const html = await page.content();
        ({ leads: pageLeads, cardCount } = parseListingHtml(cheerio.load(html), category));
      }

      // Fall back to Scrapling on either failure mode: a hard block (403/etc,
      // caught above before we even reach the DOM) or a soft block (200 OK
      // but the anti-bot challenge left the card list empty).
      if (cardCount === 0 && scraplingFallback && pythonBin) {
        console.log(`  ! SelectedFirms ${url}: 0 cards via cloak, trying Scrapling stealth fetch...`);
        const [fallback] = fetchHtmlViaScrapling(
          [{ id: 'selectedfirms', url, waitSelector: '.listing_box_wpr', timeout: 45000 }],
          { pythonBin }
        );
        if (fallback?.html) {
          ({ leads: pageLeads, cardCount } = parseListingHtml(cheerio.load(fallback.html), category));
          if (cardCount > 0) console.log(`  Scrapling fallback: ${cardCount} companies`);
        }
      }

      if (cardCount === 0) break;

      leads.push(...pageLeads);
      console.log(`  page ${pageNum}: ${cardCount} companies`);
    }
  } finally {
    await browser.close();
  }

  const seen = new Set();
  return leads.filter((l) => {
    const key = (l.name || l.website).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
