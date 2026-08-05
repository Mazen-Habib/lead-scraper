// Phase 2.2 — firm-name resolution: "Acme Solutions" -> acme-solutions.com.
// Three fallback strategies, tried in order, cheapest/most-reliable first:
//   1. Google Maps "best single match"
//   2. GitHub org lookup
//   3. Directory search across Clutch/GoodFirms/TopDevelopers
import { scrapeGoogleMaps } from '../scrapers/googleMaps.js';
import { findGithubOrgByName } from '../scrapers/githubOrgs.js';
import { resolveViaDirectorySearch } from '../scrapers/directorySearch.js';
import { normalizeName, normalizeUrl } from '../lib/normalizeUrl.js';

// Confidence is 1.0 when the candidate's own name matches the query after
// legal-suffix normalization, lower when we only have partial agreement.
export function nameConfidence(query, candidateName) {
  const q = normalizeName(query);
  const c = normalizeName(candidateName);
  if (!q || !c) return 0.3;
  if (q === c) return 1.0;
  if (c.includes(q) || q.includes(c)) return 0.7;
  return 0.3;
}

async function tryGoogleMaps(name) {
  try {
    const [top] = await scrapeGoogleMaps(name, 1, true);
    if (!top || !top.website || !normalizeUrl(top.website)) return null;
    return {
      website: top.website,
      strategy: 'google_maps',
      confidence: nameConfidence(name, top.name),
      raw: top,
    };
  } catch (err) {
    console.warn(`  ! Google Maps resolution failed: ${err.message.split('\n')[0]}`);
    return null;
  }
}

async function tryGithub(name) {
  try {
    const org = await findGithubOrgByName(name, { token: process.env.GITHUB_TOKEN || '' });
    if (!org) return null;
    return { website: org.website, strategy: 'github_orgs', confidence: nameConfidence(name, org.name), raw: org };
  } catch (err) {
    console.warn(`  ! GitHub org resolution failed: ${err.message.split('\n')[0]}`);
    return null;
  }
}

async function tryDirectorySearch(name) {
  try {
    const hit = await resolveViaDirectorySearch(name);
    if (!hit) return null;
    return { website: hit.website, strategy: 'directory_search', confidence: hit.confidence, raw: hit };
  } catch (err) {
    console.warn(`  ! Directory search resolution failed: ${err.message.split('\n')[0]}`);
    return null;
  }
}

/**
 * Resolves a firm name to a website, trying each strategy until one returns
 * a usable result. Returns { website, strategy, confidence } or null.
 */
export async function resolveFirmWebsite(name) {
  for (const strategy of [tryGoogleMaps, tryGithub, tryDirectorySearch]) {
    const hit = await strategy(name);
    if (hit) return hit;
  }
  return null;
}
