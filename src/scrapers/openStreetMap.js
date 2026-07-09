/**
 * OpenStreetMap (Overpass API) lead source.
 * Free, legal, structured JSON, no anti-bot / no browser needed.
 * Returns businesses tagged as tech-related in a given city.
 */

// Multiple public mirrors — we fail over if one is busy (Overpass returns
// 429/504/406 under load) since they share the same query language.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// OSM tag filters that map to tech / tech-related businesses.
// Each entry becomes an nwr[...] clause in the Overpass query.
const TECH_TAG_FILTERS = [
  '["office"="it"]',
  '["office"="software"]',
  '["office"="telecommunication"]',
  '["office"="web_design"]',
  '["shop"="computer"]',
  '["craft"="electronics"]',
];

function buildQuery(city, filters) {
  // Resolve the city to an area, then match every tag filter inside it.
  const clauses = filters
    .map((f) => `  nwr${f}(area.a);`)
    .join('\n');
  return `[out:json][timeout:50];
area["name"="${city}"]->.a;
(
${clauses}
);
out center tags;`;
}

/**
 * Fetches tech-related businesses for a city from OpenStreetMap.
 * Returns leads in the same shape as the Google Maps scraper.
 */
export async function scrapeOpenStreetMap(city, filters = TECH_TAG_FILTERS) {
  const query = buildQuery(city, filters);

  let data;
  let lastErr;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'lead-scraper/1.0 (contact: your-email@example.com)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90000),
      });

      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status} @ ${new URL(url).host}`);
        continue;
      }
      data = await res.json();
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!data) throw lastErr || new Error('All Overpass mirrors failed');
  const leads = [];

  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;

    const addressParts = [
      t['addr:housenumber'],
      t['addr:street'],
      t['addr:city'],
      t['addr:postcode'],
    ].filter(Boolean);

    leads.push({
      name: t.name,
      category: t.office || t.shop || t.craft || 'tech',
      website: t.website || t['contact:website'] || '',
      email: t.email || t['contact:email'] || '',
      phone: t.phone || t['contact:phone'] || '',
      address: addressParts.join(', '),
      linkedin: t['contact:linkedin'] || '',
      facebook: t['contact:facebook'] || '',
      instagram: t['contact:instagram'] || '',
      rating: '',
      reviews: '',
      maps_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }

  // De-dupe within this source by name+website (OSM often lists branches)
  const seen = new Set();
  return leads.filter((l) => {
    const key = (l.website || l.name).toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
