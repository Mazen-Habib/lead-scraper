import * as cheerio from 'cheerio';

/**
 * Scrapes a TopDevelopers.co category listing (e.g. "app-development",
 * "web-development"). Light protection — plain fetch + Cheerio works,
 * no browser/cloak engine needed. Verified against live HTML: cards are
 * `.comp_main_box.new_company_listing`, pagination is `?page=N`.
 */
export async function scrapeTopDevelopers(category, maxPages = 2) {
  const leads = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `https://www.topdevelopers.co/companies/${category}${pageNum > 1 ? `?page=${pageNum}` : ''}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      console.warn(`  ! TopDevelopers ${url} returned HTTP ${res.status}, stopping.`);
      break;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const cards = $('.comp_main_box.new_company_listing');
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const card = $(el);
      const nameLink = card.find('h3.comp_title a[itemprop="url"]').first();
      const name = nameLink.find('span[itemprop="name"]').text().trim() || nameLink.text().trim();
      const website = nameLink.attr('href') || '';
      const profileUrl = card.attr('itemid') || card.find('a.company_prof').first().attr('href') || '';
      const rating = card.find('.ratingInput').attr('value') || '';
      const reviewsText = card.find('.inputDiv span').first().text();
      const reviews = (reviewsText.match(/\d+/) || [''])[0];

      const highlights = card
        .find('.company_reviews > li')
        .map((__, li) => $(li).find('.set_es_p').text().trim().replace(/\s+/g, ' '))
        .get();
      const [companySize, hourlyRate, minProject, location] = highlights;

      leads.push({
        name,
        category: 'software developer',
        website: website.split('?')[0],
        email: '',
        phone: '',
        address: location || '',
        rating,
        reviews,
        company_size: companySize || '',
        hourly_rate: hourlyRate || '',
        min_project: minProject || '',
        maps_url: profileUrl,
      });
    });

    console.log(`  page ${pageNum}: ${cards.length} companies`);
  }

  const seen = new Set();
  return leads.filter((l) => {
    const key = (l.name || l.website).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
