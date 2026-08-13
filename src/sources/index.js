// Declarative source registry: each entry knows how to turn its slice of
// config.json into a list of scrape jobs. Replaces ~25 lines of near-identical
// try/catch per source that used to live inline in src/index.js's main().
//
// A caller can select a subset of sources by `key` (see gatherLeads's `only`
// option) — needed by on-demand/per-user runs later without touching this file.
import { scrapeGoogleMaps } from '../scrapers/googleMaps.js';
import {
  scrapeOpenStreetMap,
  TECH_TAG_FILTERS,
  HEALTHCARE_TAG_FILTERS,
  GENERAL_BUSINESS_TAG_FILTERS,
} from '../scrapers/openStreetMap.js';
import { scrapeClutch } from '../scrapers/clutch.js';
import { scrapeGoodFirms } from '../scrapers/goodFirms.js';
import { scrapeGithubOrgs } from '../scrapers/githubOrgs.js';
import { scrapeOpenCorporates } from '../scrapers/openCorporates.js';
import { scrapePseb } from '../scrapers/pseb.js';
import { scrapeTopDevelopers } from '../scrapers/topDevelopers.js';
import { scrapeSortlist } from '../scrapers/sortlist.js';
import { scrapeEventbrite } from '../scrapers/eventbrite.js';
import { scrapeDesignRush } from '../scrapers/designRush.js';
import { scrapeTechBehemoths } from '../scrapers/techBehemoths.js';
import { scrapeSelectedFirms } from '../scrapers/selectedFirms.js';

// buildJobs(config, cloak) -> [{ query, announce, run }]
//   query    - stamped onto lead.search_query (same string tag() used inline before)
//   announce - the exact console.log line to print before running the job
//   run      - () => Promise<lead[]>
export const SOURCE_REGISTRY = [
  {
    key: 'googleMaps',
    source: 'google_maps',
    engine: 'normal_scraper',
    errorName: 'Google Maps',
    buildJobs(config) {
      const c = config.googleMaps || {};
      if (!c.enabled) return [];
      return (c.searches || []).map((query) => ({
        query,
        announce: `[normal] Google Maps: "${query}"`,
        run: () => scrapeGoogleMaps(query, c.maxResultsPerSearch, c.headless),
      }));
    },
  },
  {
    // General local-business searches (dentists, hospitals, law firms,
    // restaurants, etc. — see config.json's googleMapsGeneral block) — kept
    // as its own registry key rather than merged into `googleMaps` above so
    // it can be scraped on its own schedule (weekly-scrape-general.yml)
    // without inflating the existing tech run's runtime. Reuses the exact
    // same scraper/lead shape; `source` stays 'google_maps' so scoring and
    // dedupe treat these leads identically to the tech-vertical GM leads.
    key: 'googleMapsGeneral',
    source: 'google_maps',
    engine: 'normal_scraper',
    errorName: 'Google Maps (general)',
    buildJobs(config) {
      const c = config.googleMapsGeneral || {};
      if (!c.enabled) return [];
      return (c.searches || []).map((query) => ({
        query,
        announce: `[normal] Google Maps (general): "${query}"`,
        run: () => scrapeGoogleMaps(query, c.maxResultsPerSearch, c.headless),
      }));
    },
  },
  {
    key: 'openStreetMap',
    source: 'openstreetmap',
    engine: 'normal_scraper',
    errorName: 'OSM',
    // config.openStreetMap.verticals: [{ name, cities }] — `name` selects the
    // OSM tag-filter set below (single source of truth lives in
    // openStreetMap.js's *_TAG_FILTERS exports, not duplicated into JSON), so
    // tech/healthcare/general-business coverage can differ per vertical
    // instead of one flat city list stuck to one tag-set.
    buildJobs(config) {
      const VERTICAL_FILTERS = {
        tech: TECH_TAG_FILTERS,
        healthcare: HEALTHCARE_TAG_FILTERS,
        general: GENERAL_BUSINESS_TAG_FILTERS,
      };
      const c = config.openStreetMap || {};
      if (!c.enabled) return [];
      const verticals = c.verticals || [];
      return verticals.flatMap((v) => {
        const filters = VERTICAL_FILTERS[v.name];
        if (!filters) {
          console.warn(`  !! OpenStreetMap: unknown vertical "${v.name}" — skipped`);
          return [];
        }
        return (v.cities || []).map((city) => ({
          query: `${v.name}/${city}`,
          announce: `[normal] OpenStreetMap (${v.name}): "${city}"`,
          run: () => scrapeOpenStreetMap(city, filters),
        }));
      });
    },
  },
  {
    key: 'githubOrgs',
    source: 'github_orgs',
    engine: 'normal_scraper',
    errorName: 'GitHub Orgs',
    buildJobs(config) {
      const c = config.githubOrgs || {};
      if (!c.enabled) return [];
      return (c.locations || []).map((location) => ({
        query: location,
        announce: `[normal] GitHub Orgs: "${location}"`,
        run: () =>
          scrapeGithubOrgs(location, {
            token: c.token || process.env.GITHUB_TOKEN || '',
            maxResults: c.maxResults,
          }),
      }));
    },
  },
  {
    key: 'openCorporates',
    source: 'opencorporates',
    engine: 'normal_scraper',
    errorName: 'OpenCorporates',
    buildJobs(config) {
      const c = config.openCorporates || {};
      if (!c.enabled) return [];
      return (c.searches || []).map((query) => ({
        query,
        announce: `[normal] OpenCorporates: "${query}"`,
        run: () =>
          scrapeOpenCorporates(c.jurisdiction || 'pk', query, {
            apiToken: c.apiToken,
            maxResults: c.maxResults,
          }),
      }));
    },
  },
  {
    key: 'pseb',
    source: 'pseb',
    engine: 'normal_scraper',
    errorName: 'PSEB',
    buildJobs(config) {
      const c = config.pseb || {};
      if (!c.enabled) return [];
      return [
        {
          query: 'techdestination profiles',
          announce: '[normal] PSEB/TechDestination',
          run: () => scrapePseb(),
        },
      ];
    },
  },
  {
    key: 'topDevelopers',
    source: 'topdevelopers',
    engine: 'normal_scraper',
    errorName: 'TopDevelopers',
    buildJobs(config) {
      const c = config.topDevelopers || {};
      if (!c.enabled) return [];
      return (c.categories || []).map((category) => ({
        query: category,
        announce: `[normal] TopDevelopers: "${category}"`,
        run: () => scrapeTopDevelopers(category, c.maxPages || 2),
      }));
    },
  },
  {
    key: 'eventbrite',
    source: 'eventbrite',
    engine: 'normal_scraper',
    errorName: 'Eventbrite',
    buildJobs(config) {
      const c = config.eventbrite || {};
      if (!c.enabled) return [];
      return (c.searches || []).map((search) => ({
        query: `${search.query}/${search.location}`,
        announce: `[normal] Eventbrite: "${search.query}" / "${search.location}"`,
        run: () => scrapeEventbrite(search.query, search.location, { concurrency: c.concurrency }),
      }));
    },
  },
  {
    key: 'clutch',
    source: 'clutch',
    engine: 'cloak_browser',
    errorName: 'Clutch',
    buildJobs(config, cloak) {
      const c = config.clutch || {};
      if (!c.enabled) return [];
      return (c.directories || []).map((dir) => ({
        query: dir,
        announce: `[cloak] Clutch: "${dir}"`,
        run: () => scrapeClutch(dir, cloak, c.maxPages || 2),
      }));
    },
  },
  {
    key: 'goodFirms',
    source: 'goodfirms',
    engine: 'cloak_browser',
    errorName: 'GoodFirms',
    buildJobs(config, cloak) {
      const c = config.goodFirms || {};
      if (!c.enabled) return [];
      return (c.directories || []).map((dir) => ({
        query: dir,
        announce: `[cloak] GoodFirms: "${dir}"`,
        run: () => scrapeGoodFirms(dir, cloak, c.maxPages || 2),
      }));
    },
  },
  {
    key: 'sortlist',
    source: 'sortlist',
    engine: 'cloak_browser',
    errorName: 'Sortlist',
    buildJobs(config, cloak) {
      const c = config.sortlist || {};
      if (!c.enabled) return [];
      const queries = c.queries ? c.queries : (c.categories || []).map((cat) => ({ category: cat, country: '' }));
      return queries.map((q) => {
        const label = q.country ? `${q.country}/${q.category}` : q.category;
        return {
          query: label,
          announce: `[cloak] Sortlist: "${label}"`,
          run: () => scrapeSortlist(q.category, cloak, q.country || ''),
        };
      });
    },
  },
  {
    key: 'designRush',
    source: 'designrush',
    engine: 'cloak_browser',
    errorName: 'DesignRush',
    buildJobs(config, cloak) {
      const c = config.designRush || {};
      if (!c.enabled) return [];
      const queries = c.queries ? c.queries : (c.categories || []).map((cat) => ({ category: cat, country: '' }));
      return queries.map((q) => {
        const label = q.country ? `${q.category}?country=${q.country}` : q.category;
        return {
          query: label,
          announce: `[cloak] DesignRush: "${label}"`,
          run: () => scrapeDesignRush(q.category, cloak, q.country || ''),
        };
      });
    },
  },
  {
    key: 'techBehemoths',
    source: 'techbehemoths',
    engine: 'cloak_browser',
    errorName: 'TechBehemoths',
    buildJobs(config, cloak, pythonBin) {
      const c = config.techBehemoths || {};
      if (!c.enabled) return [];
      return (c.queries || []).map((q) => {
        const label = q.country ? `${q.country}/${q.service}` : q.service;
        return {
          query: label,
          announce: `[cloak] TechBehemoths: "${label}"`,
          run: () =>
            scrapeTechBehemoths(q, cloak, c.maxPages || 1, c.maxProfileVisits || 15, {
              pythonBin,
              scraplingFallback: c.scraplingFallback !== false,
            }),
        };
      });
    },
  },
  {
    key: 'selectedFirms',
    source: 'selectedfirms',
    engine: 'cloak_browser',
    errorName: 'SelectedFirms',
    buildJobs(config, cloak, pythonBin) {
      const c = config.selectedFirms || {};
      if (!c.enabled) return [];
      return (c.queries || []).map((q) => {
        const label = q.country ? `${q.category}/${q.country}` : q.category;
        return {
          query: label,
          announce: `[cloak] SelectedFirms: "${label}"`,
          run: () =>
            scrapeSelectedFirms(q.category, cloak, q.country || '', c.maxPages || 2, {
              pythonBin,
              scraplingFallback: c.scraplingFallback !== false,
            }),
        };
      });
    },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries a source job on transient failures (network blips, momentary
// anti-bot rate limits) before giving up. Backoff: 2s, then 5s. Errors that
// are clearly permanent (bad selector, programmer error) still just fail
// after burning the retries — there's no reliable way to distinguish them
// from here, and 2 retries is cheap relative to a 6h run.
async function withRetry(run, { attempts = 3, delaysMs = [2000, 5000] } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = delaysMs[i] ?? delaysMs[delaysMs.length - 1];
        console.warn(`  retrying in ${wait / 1000}s (attempt ${i + 2}/${attempts})...`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// Stamps provenance on each lead: the data source and the engine that fetched it.
function tag(leads, { source, engine, query }) {
  const now = new Date().toISOString();
  for (const lead of leads) {
    lead.source = source;
    lead.engine = engine;
    lead.search_query = query;
    lead.scraped_at = now;
  }
  return leads;
}

// Runs every enabled source in the registry (or only `opts.only` keys) and
// returns the combined raw lead array, tagged with provenance. A failing
// source is logged and skipped — one broken directory never aborts the run.
export async function gatherLeads(config, cloak, opts = {}) {
  const { only, pythonBin = null } = opts;
  let allLeads = [];
  for (const entry of SOURCE_REGISTRY) {
    if (only && !only.includes(entry.key)) continue;
    const jobs = entry.buildJobs(config, cloak, pythonBin);
    for (const job of jobs) {
      console.log(job.announce);
      try {
        const leads = await withRetry(job.run);
        allLeads.push(...tag(leads, { source: entry.source, engine: entry.engine, query: job.query }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! ${entry.errorName} failed after retries: ${err.message.split('\n')[0]}\n`);
      }
    }
  }
  return allLeads;
}
