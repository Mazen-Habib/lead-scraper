import * as cheerio from 'cheerio';
import { openCloakPage } from '../engines/cloakEngine.js';
import { fetchHtmlViaScrapling } from '../engines/scraplingEngine.js';

// Cheerio equivalent of the primary path's page.evaluate() card extraction
// (same selectors: article.co-box, .co-box__name, "visit website" link,
// /companies/ location links). Used only by the Scrapling stealth-fetch
// fallback below, which has a static HTML string rather than a live page —
// the primary DOM-evaluate path is untouched and still runs first.
function parseCardsFromHtml(html) {
  const $ = cheerio.load(html);
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const cards = [];
  $('article.co-box').each((_, el) => {
    const card = $(el);
    let name = clean(card.find('.co-box__name').first().text());
    name = name.replace(/Verified Company/i, '').trim();
    if (!name) return;
    const profileHref = card.find('a[href*="/company/"]').first().attr('href') || '';
    const siteA = card.find('a').filter((__, a) => /visit website/i.test($(a).text())).first();
    const locLinks = card
      .find('a[href^="/companies/"]')
      .map((__, a) => clean($(a).text()))
      .get()
      .filter(Boolean);
    cards.push({
      name,
      profile: profileHref,
      website: (siteA.attr('href') || '').split('?')[0],
      city: locLinks[0] || '',
      country: locLinks[1] || '',
    });
  });
  return cards;
}

/**
 * Scrapes a TechBehemoths directory listing
 * (e.g. https://techbehemoths.com/companies/software-development/india).
 * Heavily JS-rendered (Vue/Nuxt) → runs on the CloakBrowser engine.
 * Only sponsored/featured cards expose their website inline; regular
 * listings only link to a profile page, so we visit the profile for any
 * card missing a website (capped per page via maxProfileVisits).
 *
 * If the cloak_browser session returns zero cards for a page (current anti-bot
 * defenses now block it), falls back to fetching that same URL through
 * Scrapling's StealthySession (src/engines/scraplingEngine.js) and re-parses
 * with the same selectors via parseCardsFromHtml(). Scope limit: the fallback
 * only recovers cards that expose a website inline — it does not visit profile
 * pages, so it won't backfill phone numbers or resolve missing websites the
 * way the primary path's profile-visit step does.
 * Disable via config.techBehemoths.scraplingFallback = false.
 */
export async function scrapeTechBehemoths(query, cloak = {}, maxPages = 1, maxProfileVisits = 15, opts = {}) {
  const { pythonBin = null, scraplingFallback = true } = opts;
  const { browser, page } = await openCloakPage(cloak);
  const leads = [];
  const service = query.service || 'software-development';
  const country = query.country || '';

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      let base = `https://techbehemoths.com/companies/${service}`;
      if (country) base += `/${country}`;
      const url = pageNum > 1 ? `${base}?page=${pageNum}` : base;

      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      const blocked = resp && resp.status() >= 400;
      if (blocked) {
        console.warn(`  ! TechBehemoths ${url} returned HTTP ${resp.status()}.`);
      }

      let cards = blocked
        ? []
        : await page.evaluate(() => {
            const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
            return [...document.querySelectorAll('article.co-box')]
              .map((c) => {
                const nameEl = c.querySelector('.co-box__name');
                let name = nameEl ? clean(nameEl.textContent) : '';
                name = name.replace(/Verified Company/i, '').trim();
                const profileA = c.querySelector('a[href*="/company/"]');
                const siteA = [...c.querySelectorAll('a')].find((a) => /visit website/i.test(a.textContent));
                const locLinks = [...c.querySelectorAll('a[href^="/companies/"]')]
                  .map((a) => clean(a.textContent))
                  .filter(Boolean);
                return {
                  name,
                  profile: profileA ? profileA.href : '',
                  website: siteA ? siteA.href.split('?')[0] : '',
                  city: locLinks[0] || '',
                  country: locLinks[1] || '',
                };
              })
              .filter((c) => c.name);
          });

      // Fall back to Scrapling on either failure mode: a hard block (403/etc,
      // caught above before we even reach the DOM) or a soft block (200 OK
      // but the anti-bot challenge left the card list empty).
      let usedFallback = false;
      if (cards.length === 0 && scraplingFallback && pythonBin) {
        console.log(`  ! TechBehemoths ${url}: 0 cards via cloak, trying Scrapling stealth fetch...`);
        const [fallback] = fetchHtmlViaScrapling(
          [{ id: 'techbehemoths', url, waitSelector: 'article.co-box', timeout: 45000 }],
          { pythonBin }
        );
        if (fallback?.html) {
          cards = parseCardsFromHtml(fallback.html);
          usedFallback = true;
          if (cards.length > 0) console.log(`  Scrapling fallback: ${cards.length} companies`);
        }
      }

      if (cards.length === 0) break;

      // The fallback has no live page to visit profile URLs with, so it can
      // only keep cards that already expose a website inline.
      if (usedFallback) cards = cards.filter((c) => c.website);
      if (usedFallback && cards.length === 0) break;

      let profileVisits = 0;
      for (const c of cards) {
        let website = c.website;
        let phone = '';

        if (!usedFallback && !website && c.profile && profileVisits < maxProfileVisits) {
          profileVisits++;
          try {
            await page.goto(c.profile, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            const detail = await page.evaluate(() => {
              const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
              const siteA = [...document.querySelectorAll('a')].find((a) => /visit website/i.test(a.textContent));
              const phoneA = document.querySelector('a[href^="tel:"]');
              return {
                website: siteA ? siteA.href.split('?')[0] : '',
                phone: phoneA ? clean(phoneA.textContent) : '',
              };
            });
            website = detail.website;
            phone = detail.phone;
          } catch (err) {
            console.warn(`  ! TechBehemoths profile visit failed for ${c.name}: ${err.message.split('\n')[0]}`);
          }
        }

        if (!website) continue; // no usable contact path — skip

        leads.push({
          name: c.name,
          category: service.replace(/-/g, ' '),
          website,
          email: '',
          phone,
          address: [c.city, c.country].filter(Boolean).join(', '),
          rating: '',
          reviews: '',
          company_size: '',
          hourly_rate: '',
          min_project: '',
          maps_url: c.profile,
        });
      }
      console.log(`  page ${pageNum}: ${cards.length} companies (${leads.length} with website so far)`);
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
