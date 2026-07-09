import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Scrapes a GoodFirms directory (e.g.
 * "directory/country/top-software-development-companies/ae").
 * Cloudflare-protected → runs on the CloakBrowser engine.
 * Website URLs are exposed directly (with utm params we strip).
 */
export async function scrapeGoodFirms(directory, cloak = {}, maxPages = 2) {
  const { browser, page } = await openCloakPage(cloak);
  const leads = [];

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `https://www.goodfirms.co/${directory}${pageNum > 1 ? `?page=${pageNum}` : ''}`;
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);

      if (resp && resp.status() >= 400) {
        console.warn(`  ! GoodFirms ${url} returned HTTP ${resp.status()}, stopping.`);
        break;
      }

      const pageLeads = await page.evaluate(() => {
        const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
        const txt = (el, sel) => { const n = el.querySelector(sel); return n ? clean(n.textContent) : ''; };
        return [...document.querySelectorAll('li.firm-wrapper')].map((f) => {
          const site = f.querySelector('a.visit-website');
          const profile = f.querySelector('a.visit-profile');
          // Highlight row typically: "$25 - $49/hr", "250 - 999", "Founded 2015", "Dubai, UAE"
          const highlights = [...f.querySelectorAll('.firm-pricing li, .firm-practices li, .firm-highlights li')].map((li) => clean(li.textContent));
          const hourly = highlights.find((h) => /\/\s*hr|\$\d/.test(h)) || '';
          const size = highlights.find((h) => /^\d[\d,]*\s*-\s*\d/.test(h)) || '';
          const location = highlights.find((h) => /,/.test(h) && !/\$/.test(h)) || txt(f, '.firm-location');
          return {
            name: f.getAttribute('entity-name') || txt(f, '.firm-name'),
            website: site ? site.href : '',
            profile_url: profile ? profile.href : '',
            rating: txt(f, '.rating-number'),
            reviews: (txt(f, '.visit-profile').match(/\d+/) || [''])[0],
            hourly_rate: hourly,
            company_size: size,
            location,
          };
        });
      });

      if (pageLeads.length === 0) break;

      for (const l of pageLeads) {
        leads.push({
          name: l.name,
          category: 'software developer',
          website: (l.website || '').split('?')[0],
          email: '',
          phone: '',
          address: l.location,
          rating: l.rating,
          reviews: l.reviews,
          company_size: l.company_size,
          hourly_rate: l.hourly_rate,
          min_project: '',
          maps_url: l.profile_url,
        });
      }
      console.log(`  page ${pageNum}: ${pageLeads.length} companies`);
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
