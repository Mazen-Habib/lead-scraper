// Rules-based region/country/city resolver (roadmap 4.2, plus the country+city
// granularity requested after — see memory.md) — promotes the region-keyword
// matching that used to live only in the frontend's LeadsTable.tsx (matched
// client-side against address+search_query on every filter change) into real
// columns computed once at scrape time, from the shared definitions in
// ../../shared/regions.json and ../../shared/geo.json.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { matchesWord } from './classifier.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGIONS = JSON.parse(readFileSync(resolve(root, 'shared/regions.json'), 'utf8'));
const GEO = JSON.parse(readFileSync(resolve(root, 'shared/geo.json'), 'utf8'));

// ISO 3166-1 alpha-2 -> our country slug, for the countries shared/geo.json
// already supports. Lets a source that supplies a real country code (Overture
// Places does; most scrapers here don't) resolve correctly even when its
// address/city text is unusable for keyword matching — Overture's Pakistan
// data came back with city names in Urdu script, which the English keyword
// lists below can never match, silently leaving `country` null despite the
// source having already told us exactly which country a place is in.
const ISO2_TO_SLUG = {
  AE: 'uae', SA: 'saudi-arabia', QA: 'qatar', KW: 'kuwait', BH: 'bahrain',
  OM: 'oman', JO: 'jordan', LB: 'lebanon', IQ: 'iraq', IL: 'israel',
  PS: 'palestine', EG: 'egypt', YE: 'yemen', SY: 'syria', PK: 'pakistan',
  IN: 'india', BD: 'bangladesh', LK: 'sri-lanka', NP: 'nepal', SG: 'singapore',
  PH: 'philippines', MY: 'malaysia', VN: 'vietnam', ID: 'indonesia',
  TH: 'thailand', MM: 'myanmar', KH: 'cambodia', NG: 'nigeria', KE: 'kenya',
  ZA: 'south-africa', GH: 'ghana', ET: 'ethiopia', TZ: 'tanzania',
  UG: 'uganda', MA: 'morocco', SN: 'senegal', CI: 'ivory-coast', GB: 'uk',
  DE: 'germany', NL: 'netherlands', FR: 'france', ES: 'spain', SE: 'sweden',
  NO: 'norway', DK: 'denmark', FI: 'finland', PL: 'poland', UA: 'ukraine',
  CZ: 'czech-republic', AT: 'austria', CH: 'switzerland', IT: 'italy',
  PT: 'portugal', BE: 'belgium', US: 'usa', CA: 'canada', MX: 'mexico',
  AU: 'australia', NZ: 'new-zealand', JP: 'japan', KR: 'south-korea',
  TW: 'taiwan', HK: 'hong-kong', CN: 'china',
};

function regionHaystack(lead) {
  return [lead.address, lead.search_query].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Resolves a single lead's region slug/label against the shared region
 * keyword lists. Returns null if nothing matches (address too sparse, or a
 * location the taxonomy doesn't cover yet).
 *
 * Uses word-boundary matching (matchesWord, ported from classifier.js — same
 * fix that classifier.js already had) rather than plain substring matching.
 * Substring matching let short keywords like "kl" (Kuala Lumpur) match inside
 * unrelated words — "Brooklyn", "Parkland" — misfiling US/UK leads as
 * southeast-asia. Confirmed live: 24 leads tagged southeast-asia only because
 * of that collision (see memory.md). Fixed here the same way classifier.js
 * already fixed it for industry keywords: word boundaries instead of bare
 * `includes()`.
 */
export function resolveRegion(lead) {
  const haystack = regionHaystack(lead);
  if (!haystack) return null;

  let best = null;
  for (const { slug, label, keywords } of REGIONS.regions) {
    const matched = keywords.filter((kw) => matchesWord(haystack, kw));
    if (matched.length > 0 && (!best || matched.length > best.matchCount)) {
      best = { slug, label, matchCount: matched.length };
    }
  }
  return best ? best.slug : null;
}

/** Sets `region` on every lead in place. */
export function resolveRegions(leads) {
  let resolved = 0;
  for (const lead of leads) {
    lead.region = resolveRegion(lead);
    if (lead.region) resolved++;
  }
  console.log(`  Resolved region for ${resolved}/${leads.length} leads`);
  return leads;
}

/**
 * Resolves country + city together in one pass, since a matched city implies
 * its country but not vice versa (an address can name a country with no city,
 * e.g. just "Kuwait"). City keywords are checked first — more specific beats
 * more general when both are present in the same address (as they usually
 * are: "Lahore, Pakistan"), the same "richest bucket wins" idea matchTaxonomy
 * uses for industries.
 *
 * Returns { country, city } (either can be null) rather than two separate
 * functions — computing them together means an address is only scanned once
 * per lead instead of twice.
 */
export function resolveGeo(lead) {
  const haystack = regionHaystack(lead);

  if (haystack) {
    for (const country of GEO.countries) {
      for (const city of country.cities) {
        if (city.keywords.some((kw) => matchesWord(haystack, kw))) {
          return { country: country.slug, city: city.slug };
        }
      }
    }
  }

  // A source-supplied ISO code (Overture) beats no match at all, but city
  // keyword matching above still wins when it succeeds — it's more specific,
  // and matches the "richest bucket wins" rule used elsewhere in this file.
  const isoSlug = lead.country && ISO2_TO_SLUG[lead.country.toUpperCase()];
  if (isoSlug) return { country: isoSlug, city: null };

  if (haystack) {
    for (const country of GEO.countries) {
      if (country.countryKeywords.some((kw) => matchesWord(haystack, kw))) {
        return { country: country.slug, city: null };
      }
    }
  }
  return { country: null, city: null };
}

/** Sets `country` and `city` on every lead in place. */
export function resolveGeos(leads) {
  let resolvedCountry = 0;
  let resolvedCity = 0;
  for (const lead of leads) {
    const { country, city } = resolveGeo(lead);
    lead.country = country;
    lead.city = city;
    if (country) resolvedCountry++;
    if (city) resolvedCity++;
  }
  console.log(`  Resolved country for ${resolvedCountry}/${leads.length} leads, city for ${resolvedCity}/${leads.length}`);
  return leads;
}

export function countryLabel(slug) {
  return GEO.countries.find((c) => c.slug === slug)?.label ?? slug;
}

export function cityLabel(slug) {
  for (const country of GEO.countries) {
    const city = country.cities.find((c) => c.slug === slug);
    if (city) return city.label;
  }
  return slug;
}

export { REGIONS, GEO };
