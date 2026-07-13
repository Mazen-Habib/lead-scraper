import * as cheerio from 'cheerio';
import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * DesignRush agency directory.
 * Supports global: https://www.designrush.com/agency/{category}
 * and country-filtered: https://www.designrush.com/agency/{category}?country={COUNTRY}
 * Cloudflare/bot-protected — cloak engine required.
 */
export async function scrapeDesignRush(category, cloak = {}, country = '') {
  const base = `https://www.designrush.com/agency/${category}`;
  const url = country ? `${base}?country=${country}` : base;
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

  const label = country ? `${category}?country=${country}` : category;
  console.log(`  DesignRush ${label}: ${leads.length} agencies`);
  return leads;
}
