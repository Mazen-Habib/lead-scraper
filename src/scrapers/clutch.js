import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Scrapes a Clutch.co directory (e.g. "ae/developers", "pk/developers/mobile-app").
 * Clutch is Cloudflare-protected, so this runs on the CloakBrowser engine.
 * Returns leads with rich firmographics: rating, reviews, size, hourly rate, min project.
 */

// Clutch links out to company sites via a redirect wrapper; the real URL is in the `u=` param.
function decodeWebsite(href) {
  if (!href) return '';
  try {
    const u = new URL(href).searchParams.get('u');
    if (!u) return '';
    const dest = decodeURIComponent(u);
    const host = new URL(dest).hostname;
    if (/clutch\.co|ppc\.clutch/i.test(host)) return '';
    return dest.split('?')[0];
  } catch {
    return '';
  }
}

export async function scrapeClutch(directory, cloak = {}, maxPages = 2) {
  const { browser, page } = await openCloakPage(cloak);
  const leads = [];

  try {
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const url = `https://clutch.co/${directory}${pageNum > 0 ? `?page=${pageNum}` : ''}`;
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);

      if (resp && resp.status() >= 400) {
        console.warn(`  ! Clutch ${url} returned HTTP ${resp.status()}, stopping.`);
        break;
      }

      const pageLeads = await page.evaluate(() => {
        const txt = (el, sel) => {
          const n = el.querySelector(sel);
          return n ? n.textContent.trim().replace(/\s+/g, ' ') : '';
        };
        return [...document.querySelectorAll('.provider')].map((p) => {
          const wl = p.querySelector('a[href*="r.clutch.co/redirect"]');
          const profile = p.querySelector('.provider__title-link');
          return {
            name: p.getAttribute('data-title') || txt(p, 'h3'),
            website_href: wl ? wl.href : '',
            profile_url: profile ? profile.href : '',
            location: txt(p, '.provider__highlights-item.location').replace(/^Location\s*/i, ''),
            tagline: txt(p, '.provider__description-text-more, .provider__project-highlight-text--summary'),
            rating: txt(p, '.sg-rating__number'),
            reviews: txt(p, '.sg-rating__reviews').replace(/[^0-9]/g, ''),
            min_project: txt(p, '.min-project-size').replace(/^Min\.?\s*project size\s*/i, ''),
            hourly_rate: txt(p, '.hourly-rate').replace(/^Hourly rate\s*/i, ''),
            company_size: txt(p, '.employees-count').replace(/^Employees\s*/i, ''),
          };
        });
      });

      if (pageLeads.length === 0) break;

      for (const l of pageLeads) {
        leads.push({
          name: l.name,
          category: 'software developer',
          website: decodeWebsite(l.website_href),
          email: '',
          phone: '',
          address: l.location,
          rating: l.rating,
          reviews: l.reviews,
          company_size: l.company_size,
          hourly_rate: l.hourly_rate,
          min_project: l.min_project,
          maps_url: l.profile_url,
        });
      }
      console.log(`  page ${pageNum}: ${pageLeads.length} companies`);
    }
  } finally {
    await browser.close();
  }

  // De-dupe within source
  const seen = new Set();
  return leads.filter((l) => {
    const key = (l.name || l.website).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
