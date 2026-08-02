import * as cheerio from 'cheerio';
import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Scrapes a SelectedFirms directory listing
 * (e.g. https://selectedfirms.co/companies/software-development/india).
 * Replaces the earlier "Manifest" source, which turned out to be a London
 * design agency's own site, not a company directory.
 * Website URL is exposed directly in the listing (a.website-click), so no
 * per-profile visit is needed — unlike TechBehemoths.
 */
export async function scrapeSelectedFirms(category, cloak = {}, country = '', maxPages = 2) {
  const { browser, page } = await openCloakPage(cloak);
  const leads = [];

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      let base = `https://selectedfirms.co/companies/${category}`;
      if (country) base += `/${country}`;
      const url = pageNum > 1 ? `${base}?page=${pageNum}` : base;

      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      if (resp && resp.status() >= 400) {
        console.warn(`  ! SelectedFirms ${url} returned HTTP ${resp.status()}, stopping.`);
        break;
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const cards = $('.listing_box_wpr');
      if (cards.length === 0) break;

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
      console.log(`  page ${pageNum}: ${cards.length} companies`);
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
