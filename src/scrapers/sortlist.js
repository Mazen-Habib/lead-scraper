import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Sortlist.com agency directory.
 * Supports global: https://www.sortlist.com/{category}
 * and country-specific: https://www.sortlist.com/{country}/{category}
 * Uses __NEXT_DATA__ JSON embedded in the page — more reliable than DOM scraping.
 */
export async function scrapeSortlist(category, cloak = {}, country = '') {
  const url = country
    ? `https://www.sortlist.com/${country}/${category}`
    : `https://www.sortlist.com/${category}`;

  const { browser, page } = await openCloakPage(cloak);
  let html;

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() >= 400) {
      console.warn(`  ! Sortlist ${url} returned HTTP ${resp.status()}.`);
      return [];
    }
    html = await page.content();
  } finally {
    await browser.close();
  }

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    console.warn(`  ! Sortlist ${url}: no __NEXT_DATA__ found, page structure may have changed.`);
    return [];
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    console.warn(`  ! Sortlist ${url}: __NEXT_DATA__ was not valid JSON.`);
    return [];
  }

  const pageData = data?.props?.pageProps?.data;
  const sections = [pageData?.organicAgencies, pageData?.paidAgencies].filter(Boolean);
  const agencies = new Map();
  for (const section of sections) {
    for (const item of section.included || []) {
      if (item.type === 'agency' && !agencies.has(item.id)) agencies.set(item.id, item.attributes);
    }
  }

  const leads = [];
  for (const a of agencies.values()) {
    const address = a.address?.en || Object.values(a.address || {})[0] || '';
    leads.push({
      name: a.name || '',
      category: category.replace(/-/g, ' '),
      website: a.website_url || a.website || '',
      email: '',
      phone: '',
      address,
      rating: '',
      reviews: a.reviews_count != null ? String(a.reviews_count) : '',
      company_size: a.team_size != null ? String(a.team_size) : '',
      maps_url: a.slug ? `https://www.sortlist.com/agency/${a.slug}` : '',
    });
  }

  const label = country ? `${country}/${category}` : category;
  console.log(`  Sortlist ${label}: ${leads.length} agencies`);
  return leads.filter((l) => l.name);
}
