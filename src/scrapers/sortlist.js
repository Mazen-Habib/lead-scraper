import { openCloakPage } from '../engines/cloakEngine.js';

/**
 * Sortlist.com agency directory (e.g. "software-development", "web-development").
 * Plain `fetch`/curl gets a 200 with real HTML, but Node's fetch client is
 * fingerprinted and blocked with 403 — confirmed by testing curl (200) vs.
 * Node fetch (403) against the identical URL. Runs on the cloak engine
 * instead. The page is Next.js SSR and embeds full agency data as JSON in
 * a `<script id="__NEXT_DATA__">` tag — reading that JSON directly is far
 * more reliable than DOM scraping. Pagination isn't needed: a single
 * category page already returns the full organic+paid agency set (~20-30
 * agencies) via `data.organicAgencies`/`data.paidAgencies`, each with an
 * `included` array of the actual agency records (JSON:API style).
 */
export async function scrapeSortlist(category, cloak = {}) {
  const url = `https://www.sortlist.com/${category}`;
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

  // Note: `sectors` on the agency record is the *client industries served*
  // (e.g. "Healthcare", "Retail"), not the agency's own service category —
  // using the query category itself is more accurate here.
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

  console.log(`  Sortlist ${category}: ${leads.length} agencies`);
  return leads.filter((l) => l.name);
}
