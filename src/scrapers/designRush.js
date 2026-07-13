import * as cheerio from 'cheerio';
import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * DesignRush agency directory (e.g. "software-development", "web-development-companies").
 * Cloudflare/bot-protected — cloak engine required (verified: plain fetch/curl
 * gets 200 with a bot-check shell in some cases, plain Playwright still gets
 * challenged). Cards are `article.js-agency-item`, tagged with reliable
 * `data-agency-name`/`data-gtm-agency-category` attributes — no location
 * field is present on the listing card (only on individual profile pages,
 * not worth a second request per agency for this field).
 */
export async function scrapeDesignRush(category, cloak = {}) {
  const url = `https://www.designrush.com/agency/${category}`;
  const { browser, page } = await openCloakPage(cloak);
  let html;

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() >= 400) {
      console.warn(`  ! DesignRush ${url} returned HTTP ${resp.status()}.`);
      return [];
    }
    await page.waitForTimeout(5000);
    html = await page.content();
  } finally {
    await browser.close();
  }

  const $ = cheerio.load(html);
  const leads = [];

  $('article.js-agency-item').each((_, el) => {
    const card = $(el);
    const name = card.attr('data-agency-name') || card.find('.item-title').text().trim();
    if (!name) return;
    const website = card.find('a.gtm-agency-website-link').first().attr('href') || '';
    const profileUrl = card.find('a.gtm-agency-profile-link').first().attr('href') || '';
    const rating = card.find('.rate strong').first().text().trim();
    const reviewsText = card.find('.rate small').first().text();
    const reviews = (reviewsText.match(/\d+/) || [''])[0];
    const topService = card.find('.js-item-services-item span').first().text().trim();

    leads.push({
      name,
      category: topService || card.attr('data-gtm-agency-category')?.replace(/-/g, ' ') || 'software developer',
      website: website.split('?')[0],
      email: '',
      phone: '',
      address: '',
      rating,
      reviews,
      maps_url: profileUrl,
    });
  });

  console.log(`  DesignRush ${category}: ${leads.length} agencies`);
  return leads;
}
