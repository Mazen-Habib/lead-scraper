import * as cheerio from 'cheerio';

/**
 * Eventbrite tech-event organizers, e.g. companies/communities running
 * "Karachi Tech Mixer", hackathons, meetups. No anti-bot on this path
 * (plain fetch works). Two-step scrape:
 *   1. `/d/{location}/{query}/` search page embeds full results as
 *      `window.__SERVER_DATA__ = {...}` — extracted via balanced-brace
 *      parsing (the trailing content after the JSON isn't valid JS-as-JSON,
 *      so a naive `indexOf('</script>')` slice fails).
 *   2. Each event only exposes `primary_organizer_id`, not organizer
 *      name/website — those live on the organizer's own page
 *      (`/o/{id}`), server-rendered as plain HTML (`<title>`, `og:description`,
 *      and social links), fetched with limited concurrency.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extractBalancedJson(str, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return str.slice(openIdx, i + 1);
    }
  }
  return null;
}

async function fetchOrganizer(organizerId) {
  const url = `https://www.eventbrite.com/o/${organizerId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  const name = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const description = $('meta[property="og:description"]').attr('content') || '';
  const socialLinks = $('[class*="socialBlock"] a')
    .map((_, a) => $(a).attr('href'))
    .get();

  const website = socialLinks.find(
    (h) => h && !/facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|eventbrite\./i.test(h)
  ) || '';
  const facebook = socialLinks.find((h) => h && /facebook\.com/i.test(h)) || '';
  const instagram = socialLinks.find((h) => h && /instagram\.com/i.test(h)) || '';
  const linkedin = socialLinks.find((h) => h && /linkedin\.com/i.test(h)) || '';

  return { name, description, website, facebook, instagram, linkedin };
}

/**
 * @param {string} query - e.g. "software development"
 * @param {string} location - Eventbrite location slug, e.g. "pakistan"
 */
export async function scrapeEventbrite(query, location, opts = {}) {
  const { concurrency = 5 } = opts;
  const searchUrl = `https://www.eventbrite.com/d/${encodeURIComponent(location)}/${encodeURIComponent(query)}/`;
  const res = await fetch(searchUrl, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.warn(`  ! Eventbrite ${searchUrl} returned HTTP ${res.status}.`);
    return [];
  }
  const html = await res.text();
  const marker = 'window.__SERVER_DATA__';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) {
    console.warn(`  ! Eventbrite ${searchUrl}: no __SERVER_DATA__ found, page structure may have changed.`);
    return [];
  }
  const openIdx = html.indexOf('{', html.indexOf('=', markerIdx));
  const jsonStr = extractBalancedJson(html, openIdx);
  if (!jsonStr) {
    console.warn(`  ! Eventbrite ${searchUrl}: could not parse __SERVER_DATA__.`);
    return [];
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    console.warn(`  ! Eventbrite ${searchUrl}: __SERVER_DATA__ was not valid JSON.`);
    return [];
  }

  const events = data?.search_data?.events?.results || [];
  const uniqueOrganizers = new Map(); // organizerId -> { eventName, venue, address, tags }
  for (const e of events) {
    if (!e.primary_organizer_id || uniqueOrganizers.has(e.primary_organizer_id)) continue;
    uniqueOrganizers.set(e.primary_organizer_id, {
      eventName: e.name || '',
      venue: e.primary_venue?.name || '',
      address: e.primary_venue?.address?.localized_address_display || '',
      tags: (e.tags || []).map((t) => t.display_name).filter(Boolean),
    });
  }

  const queue = [...uniqueOrganizers.entries()];
  const leads = [];
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const [organizerId, meta] = queue.shift();
      try {
        const org = await fetchOrganizer(organizerId);
        if (org && org.name && org.name !== 'Organizer') {
          leads.push({
            name: org.name,
            category: meta.tags[0] || 'tech events / community',
            website: org.website,
            email: '',
            phone: '',
            address: meta.address,
            linkedin: org.linkedin,
            facebook: org.facebook,
            instagram: org.instagram,
            rating: '',
            reviews: '',
            maps_url: `https://www.eventbrite.com/o/${organizerId}`,
          });
        }
      } catch {
        /* skip organizer on error */
      }
      done++;
      process.stdout.write(`  Eventbrite organizers checked ${done}/${queue.length + done}...\r`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('');
  console.log(`  Eventbrite ${query}/${location}: ${leads.length} organizers`);
  return leads;
}
