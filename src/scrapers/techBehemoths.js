import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Scrapes a TechBehemoths directory listing
 * (e.g. https://techbehemoths.com/companies/software-development/india).
 * Heavily JS-rendered (Vue/Nuxt) → runs on the CloakBrowser engine.
 * Only sponsored/featured cards expose their website inline; regular
 * listings only link to a profile page, so we visit the profile for any
 * card missing a website (capped per page via maxProfileVisits).
 */
export async function scrapeTechBehemoths(query, cloak = {}, maxPages = 1, maxProfileVisits = 15) {
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
      if (resp && resp.status() >= 400) {
        console.warn(`  ! TechBehemoths ${url} returned HTTP ${resp.status()}, stopping.`);
        break;
      }

      const cards = await page.evaluate(() => {
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

      if (cards.length === 0) break;

      let profileVisits = 0;
      for (const c of cards) {
        let website = c.website;
        let phone = '';

        if (!website && c.profile && profileVisits < maxProfileVisits) {
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
