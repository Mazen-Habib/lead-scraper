// Turns a saved search's filter into REAL scrape jobs (roadmap Phase 6).
//
// This is the piece that stops personalized leads from being a bluff. A saved
// search's filter_json is a filter over the *existing corpus* — tier, industry,
// region, score, hasEmail and so on. Re-running that filter against the leads
// table on a cron would return the same stale rows forever while calling them
// "live". To actually deliver fresh leads we have to go scrape for them, which
// means translating (industry, region) into the vocabulary each directory
// actually speaks: Clutch wants `ae/developers`, GoodFirms wants a country-name
// path, DesignRush wants an ISO-2 code, TechBehemoths wants a full country slug.
//
// The mapping lives in shared/sourceTargets.json and reuses only tokens already
// proven by config.json's curated targets. Where a source has no equivalent
// category for an industry (e.g. GoodFirms has no marketing directory), it is
// reported as a coverage gap instead of being pointed at something almost-right.
//
// Output is a synthetic config object in exactly the shape config.json already
// uses, so it feeds straight into gatherLeads(config, cloak, { only }) with no
// changes to any scraper.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TARGETS = JSON.parse(readFileSync(resolve(root, 'shared/sourceTargets.json'), 'utf8'));
const TAXONOMY = JSON.parse(readFileSync(resolve(root, 'shared/taxonomy.json'), 'utf8'));

// Quick tier keeps a personalized run in the minutes, not hours: Google Maps is
// the broadest and most reliably parameterizable source, and Clutch/GoodFirms
// are the two richest directories. Deep adds the rest.
export const QUICK_SOURCES = ['googleMaps', 'clutch', 'goodFirms'];
export const DEEP_SOURCES = [
  'googleMaps',
  'clutch',
  'goodFirms',
  'designRush',
  'sortlist',
  'techBehemoths',
  'selectedFirms',
];

// Caps so one saved search can never queue an unbounded run.
const MAX_JOBS_PER_SOURCE = { quick: 6, deep: 4 };
const MAX_GM_CITIES = { quick: 4, deep: 6 };

const industryLabel = (slug) =>
  TAXONOMY.industries.find((i) => i.slug === slug)?.label || slug;

/** All regions, used when a saved search doesn't pin one down. */
const ALL_REGION_SLUGS = Object.keys(TARGETS.regions);

/**
 * Builds a synthetic scraper config from a saved search filter.
 *
 * @param filter  saved_searches.filter_json — only `industry` and `region` can
 *                be expressed as scrape parameters. The rest (tier, minScore,
 *                hasEmail, search…) are applied by the worker AFTER scraping,
 *                since no directory lets you search by our own lead score.
 * @param opts    { depth: 'quick' | 'deep' }
 * @returns { config, only, coverage }
 *          coverage = { industry, regions, covered: [...], skipped: [{source, reason}], jobCount }
 */
export function buildScrapeConfig(filter = {}, opts = {}) {
  const depth = opts.depth === 'deep' ? 'deep' : 'quick';
  const sources = depth === 'deep' ? DEEP_SOURCES : QUICK_SOURCES;
  const maxPer = MAX_JOBS_PER_SOURCE[depth];

  const industrySlug = filter.industry || null;
  const industry = industrySlug
    ? TARGETS.industries[industrySlug] || null
    : TARGETS.defaults.industry;

  // An unknown industry slug is a real problem — fall back to the broad default
  // rather than producing zero jobs, but say so in coverage.
  const industryKnown = !industrySlug || !!TARGETS.industries[industrySlug];
  const ind = industry || TARGETS.defaults.industry;

  // No region pinned = scrape across all of them, capped, rather than nothing.
  const regionSlugs = filter.region
    ? TARGETS.regions[filter.region]
      ? [filter.region]
      : []
    : ALL_REGION_SLUGS;

  const config = {};
  const covered = [];
  const skipped = [];
  let jobCount = 0;

  const regionsUnknown = !!filter.region && regionSlugs.length === 0;
  if (regionsUnknown) {
    skipped.push({ source: '*', reason: `unknown region "${filter.region}"` });
  }
  if (!industryKnown) {
    skipped.push({ source: '*', reason: `unknown industry "${filter.industry}" — used broad default` });
  }

  const regions = regionSlugs.map((slug) => ({ slug, ...TARGETS.regions[slug] }));

  for (const source of sources) {
    // Google Maps is handled separately — it takes free text, not tokens, which
    // is exactly why it can cover any (industry, region) pair.
    if (source === 'googleMaps') {
      const term = ind.gmTerm || TARGETS.defaults.industry.gmTerm;
      const cities = regions.flatMap((r) => r.cities || []).slice(0, MAX_GM_CITIES[depth]);
      if (cities.length === 0) {
        skipped.push({ source, reason: 'no cities known for the selected region' });
        continue;
      }
      const searches = cities.map((city) => `${term} in ${city}`);
      config.googleMaps = {
        enabled: true,
        searches,
        maxResultsPerSearch: depth === 'deep' ? 40 : 20,
        headless: true,
      };
      covered.push(source);
      jobCount += searches.length;
      continue;
    }

    const category = ind[source];
    if (!category) {
      skipped.push({
        source,
        reason: `no ${source} category for industry "${industrySlug || 'any'}"`,
      });
      continue;
    }

    const countries = regions.flatMap((r) => r[source] || []);
    if (countries.length === 0) {
      skipped.push({ source, reason: `no ${source} coverage for the selected region` });
      continue;
    }
    const limited = countries.slice(0, maxPer);

    switch (source) {
      case 'clutch':
        config.clutch = {
          enabled: true,
          directories: limited.map((c) => `${c}/${category}`),
          maxPages: depth === 'deep' ? 2 : 1,
        };
        break;
      case 'goodFirms':
        config.goodFirms = {
          enabled: true,
          directories: limited.map((c) => `directory/country/${category}/${c}`),
          maxPages: depth === 'deep' ? 2 : 1,
        };
        break;
      case 'designRush':
        config.designRush = {
          enabled: true,
          queries: limited.map((c) => ({ category, country: c })),
        };
        break;
      case 'sortlist':
        config.sortlist = {
          enabled: true,
          queries: limited.map((c) => ({ category, country: c })),
        };
        break;
      case 'techBehemoths':
        config.techBehemoths = {
          enabled: true,
          queries: limited.map((c) => ({ service: category, country: c })),
          maxPages: 1,
          maxProfileVisits: depth === 'deep' ? 15 : 8,
        };
        break;
      case 'selectedFirms':
        config.selectedFirms = {
          enabled: true,
          queries: limited.map((c) => ({ category, country: c })),
          maxPages: depth === 'deep' ? 2 : 1,
        };
        break;
      default:
        continue;
    }
    covered.push(source);
    jobCount += limited.length;
  }

  return {
    config,
    only: covered,
    coverage: {
      industry: industrySlug,
      industryLabel: industrySlug ? industryLabel(industrySlug) : 'any',
      regions: regionSlugs,
      depth,
      covered,
      skipped,
      jobCount,
    },
  };
}

/**
 * Human-readable explanation of what a run will (or won't) do — surfaced to the
 * user instead of letting a zero-coverage run look like a successful empty one.
 */
export function describeCoverage(coverage) {
  if (coverage.jobCount === 0) {
    return `No source covers ${coverage.industryLabel} in ${
      coverage.regions.join(', ') || 'the selected region'
    }.`;
  }
  const base = `${coverage.jobCount} scrape jobs across ${coverage.covered.join(', ')} (${coverage.depth} scan).`;
  if (coverage.skipped.length === 0) return base;
  return `${base} Skipped: ${coverage.skipped.map((s) => `${s.source} — ${s.reason}`).join('; ')}.`;
}

/**
 * Stable signature for a scrape. Saved searches from different users that would
 * scrape the same thing share one run, so cost scales with distinct searches
 * rather than with users.
 */
export function scrapeSignature(filter = {}, depth = 'quick') {
  return `${filter.industry || 'any'}|${filter.region || 'all'}|${depth === 'deep' ? 'deep' : 'quick'}`;
}
