// Phone number extraction — validates and normalizes to E.164 via
// libphonenumber-js (Google's libphonenumber ported to JS) instead of
// hand-rolled regex, so a price ("$25,000"), zip code, or date never gets
// mistaken for a number the way a naive digit-run regex would.
//
// A `defaultCountry` hint (ISO 3166-1 alpha-2, e.g. "PK") lets a bare local
// number like "0300-1234567" or "021-32345678" resolve correctly. Without a
// hint, only explicit "+"-prefixed international numbers are found — that's
// a deliberate precision-over-recall tradeoff: guessing the wrong country for
// an ambiguous local-format number produces a confidently wrong phone number,
// which is worse than no phone number at all.
import { findPhoneNumbersInText } from 'libphonenumber-js';
import { ISO2_TO_SLUG } from '../quality/geography.js';

const SLUG_TO_ISO2 = Object.fromEntries(
  Object.entries(ISO2_TO_SLUG).map(([iso2, slug]) => [slug, iso2])
);

/** Maps a lead's already-resolved `country` slug (see geography.js) back to
 * the ISO2 code libphonenumber-js expects, or undefined if unresolved/unknown. */
export function countrySlugToIso2(slug) {
  return SLUG_TO_ISO2[slug] || undefined;
}

/**
 * Finds valid phone numbers in text (HTML or plain text — libphonenumber-js
 * ignores markup noise fine either way). Returns E.164-formatted strings
 * ("+923001234567"), deduped, most-specific-match first.
 *
 * defaultCountry: ISO2 code (e.g. "PK") used to resolve bare local numbers.
 */
export function extractPhoneNumbers(text, defaultCountry) {
  if (!text) return [];
  let matches;
  try {
    matches = findPhoneNumbersInText(text, defaultCountry);
  } catch {
    return []; // malformed input the library can't tokenize — never throw for this
  }
  const seen = new Set();
  const numbers = [];
  for (const m of matches) {
    if (!m.number.isValid()) continue;
    const e164 = m.number.number;
    if (seen.has(e164)) continue;
    seen.add(e164);
    numbers.push(e164);
  }
  return numbers;
}

// GEO.countries entries carry both a slug (geography.js's resolveGeo) and,
// where known, an ISO2 code — reused here so a scraper that already knows the
// target country (config-driven queries almost always do) can pass a slug
// straight through without the caller needing to know about ISO codes at all.
export function resolveDefaultCountryIso2(countrySlugOrIso2) {
  if (!countrySlugOrIso2) return undefined;
  if (/^[A-Z]{2}$/.test(countrySlugOrIso2)) return countrySlugOrIso2;
  return countrySlugToIso2(countrySlugOrIso2.toLowerCase());
}
