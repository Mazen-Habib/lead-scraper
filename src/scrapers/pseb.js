import * as cheerio from 'cheerio';

/**
 * PSEB (Pakistan Software Export Board) member directory. pseb.org.pk now
 * redirects to techdestination.com, whose /profiles/ listing is a plain
 * server-rendered page (data is present in the raw HTML, just CSS-hidden
 * for some card types) — no cloak engine needed. It mixes three card kinds:
 * registered companies (`.tech-company-profile`, some with a real website
 * link), individual freelancers (`.tech-user-profile`, some with a LinkedIn
 * link), and call-center firms (`.tech-callcenter-profile`, no contact data
 * found on this listing — skipped). Only single-page (no "load next page"
 * AJAX pagination) is implemented; that's already ~45 leads.
 */
export async function scrapePseb() {
  const url = 'https://techdestination.com/profiles/';
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    console.warn(`  ! PSEB/TechDestination ${url} returned HTTP ${res.status}.`);
    return [];
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const leads = [];

  $('.tech-company-profile .tech-api-profile').each((_, el) => {
    const card = $(el);
    const name = card.find('.name').first().text().trim();
    if (!name) return;
    const website = card.find('a[href^="http"]').first().attr('href') || '';
    const location = card.find('.location').first().text().trim();
    const expertise = card
      .find('.EXPERTISE .ecperties-overflow div')
      .map((__, e) => $(e).text().trim())
      .get()
      .filter(Boolean);

    leads.push({
      name,
      category: expertise[0] || 'software developer',
      website,
      email: '',
      phone: '',
      address: location,
      linkedin: '',
      facebook: '',
      instagram: '',
      rating: '',
      reviews: '',
      maps_url: '',
    });
  });

  $('.tech-user-profile .tech-api-profile').each((_, el) => {
    const card = $(el);
    const name = card.find('.name').first().text().trim();
    const linkedin = card.find('.View-Profile a').attr('href') || '';
    if (!name || !linkedin.includes('linkedin.com')) return;
    const location = card.find('.location').first().text().trim();
    const expertise = card
      .find('.EXPERTISE .ecperties-overflow div')
      .map((__, e) => $(e).text().trim())
      .get()
      .filter(Boolean);

    leads.push({
      name,
      category: expertise[0] || 'freelance tech professional',
      website: '',
      email: '',
      phone: '',
      address: location,
      linkedin,
      facebook: '',
      instagram: '',
      rating: '',
      reviews: '',
      maps_url: '',
    });
  });

  const seen = new Set();
  const deduped = leads.filter((l) => {
    const key = (l.website || l.linkedin || l.name).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  PSEB/TechDestination: ${deduped.length} leads (companies + freelancers with contact points)`);
  return deduped;
}
