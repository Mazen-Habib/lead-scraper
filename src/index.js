import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { scrapeGoogleMaps } from './scrapers/googleMaps.js';
import { scrapeOpenStreetMap } from './scrapers/openStreetMap.js';
import { scrapeClutch } from './scrapers/clutch.js';
import { scrapeGoodFirms } from './scrapers/goodFirms.js';
import { scrapeGithubOrgs } from './scrapers/githubOrgs.js';
import { scrapeOpenCorporates } from './scrapers/openCorporates.js';
import { scrapePseb } from './scrapers/pseb.js';
import { scrapeTopDevelopers } from './scrapers/topDevelopers.js';
import { scrapeSortlist } from './scrapers/sortlist.js';
import { scrapeEventbrite } from './scrapers/eventbrite.js';
import { scrapeDesignRush } from './scrapers/designRush.js';
import { enrichLeads } from './scrapers/emailFinder.js';
import { dedupeKey } from './lib/normalizeUrl.js';
import { filterByIcp, filterByContactPoint } from './quality/qualityFilter.js';
import { verifyLeads } from './quality/emailVerifier.js';
import { scoreLeads } from './quality/scorer.js';
import { syncLeadsToSupabase } from './lib/pushToSupabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'config.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSV_COLUMNS = [
  ['name', 'company_name'],
  ['category', 'category'],
  ['website', 'website'],
  ['email', 'email'],
  ['all_emails', 'all_emails'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['linkedin', 'linkedin'],
  ['facebook', 'facebook'],
  ['instagram', 'instagram'],
  ['rating', 'rating'],
  ['reviews', 'review_count'],
  ['company_size', 'company_size'],
  ['hourly_rate', 'hourly_rate'],
  ['min_project', 'min_project'],
  ['search_query', 'search_query'],
  ['maps_url', 'profile_url'],
  ['source', 'source'], // which data source: google_maps, openstreetmap, clutch, goodfirms
  ['engine', 'engine'], // which tool fetched it: normal_scraper or cloak_browser
  ['email_verified', 'email_verified'],
  ['score', 'score'],   // 0-100 composite quality score
  ['tier', 'tier'],     // A / B / C / D — A is top tier
  ['scraped_at', 'scraped_at'],
];

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(records) {
  const header = CSV_COLUMNS.map(([, title]) => title).join(',');
  const rows = records.map((rec) =>
    CSV_COLUMNS.map(([id]) => csvCell(rec[id])).join(',')
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

function runTimestamp() {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}-${pad(n.getHours())}${pad(n.getMinutes())}`;
}

function loadMasterJson(jsonPath) {
  if (!existsSync(jsonPath)) return [];
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    console.warn('  Warning: could not parse master.json, starting fresh.');
    return [];
  }
}

function pruneExpired(leads, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const pruned = leads.filter((l) => {
    if (!l.scraped_at) return true;
    return new Date(l.scraped_at).getTime() > cutoff;
  });
  const dropped = leads.length - pruned.length;
  if (dropped > 0) console.log(`  Pruned ${dropped} leads older than ${days} days from master`);
  return pruned;
}

function mergeMaster(existing, newLeads) {
  const byKey = new Map();
  for (const lead of existing) {
    const key = dedupeKey(lead);
    if (key) byKey.set(key, { ...lead });
  }
  let added = 0;
  for (const lead of newLeads) {
    const key = dedupeKey(lead);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { ...lead });
      added++;
    } else {
      const base = byKey.get(key);
      for (const [field] of CSV_COLUMNS) {
        if (!base[field] && lead[field]) base[field] = lead[field];
      }
    }
  }
  console.log(`  +${added} new leads added to master (${byKey.size} total unique)`);
  return [...byKey.values()];
}

// OneDrive can hold a sync lock on the target for several seconds (EBUSY).
// Retry with backoff; if it stays locked, fall back to a timestamped filename
// so the run's data is never lost.
async function writeCsv(records, outPath, attempts = 8) {
  const content = toCsv(records);
  for (let i = 1; i <= attempts; i++) {
    try {
      writeFileSync(outPath, content, 'utf8');
      return outPath;
    } catch (err) {
      if (err.code === 'EBUSY' && i < attempts) {
        console.warn(`  file locked (OneDrive/AV), retry ${i}/${attempts - 1}...`);
        await sleep(Math.min(1000 * i, 4000));
        continue;
      }
      if (err.code === 'EBUSY') {
        // Give up on the locked name; write to a fresh one instead.
        const fallback = outPath.replace(/\.csv$/i, `-${Date.now()}.csv`);
        writeFileSync(fallback, content, 'utf8');
        console.warn(`  target was locked; wrote to ${fallback} instead.`);
        return fallback;
      }
      throw err;
    }
  }
}

// Merge-dedup: for each unique company key, merge all scraped versions so
// the final lead has the richest possible set of fields (e.g. Clutch provides
// rating/company_size while GitHub provides email — both survive).
function dedupe(leads) {
  const byKey = new Map();
  for (const lead of leads) {
    const key = dedupeKey(lead);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { ...lead });
    } else {
      const base = byKey.get(key);
      for (const [field] of CSV_COLUMNS) {
        if (!base[field] && lead[field]) base[field] = lead[field];
      }
    }
  }
  const merged = [...byKey.values()];
  const dropped = leads.length - merged.length;
  if (dropped > 0) console.log(`  ${dropped} duplicate leads merged`);
  return merged;
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

async function main() {
  console.log('Lead scraper starting\n');
  let allLeads = [];
  const cloak = config.cloak || {};

  // === NORMAL SCRAPERS (our own Playwright / HTTP) ===

  // Source: Google Maps
  const gmaps = config.googleMaps || {};
  if (gmaps.enabled) {
    for (const query of gmaps.searches || []) {
      console.log(`[normal] Google Maps: "${query}"`);
      try {
        const leads = await scrapeGoogleMaps(query, gmaps.maxResultsPerSearch, gmaps.headless);
        allLeads.push(...tag(leads, { source: 'google_maps', engine: 'normal_scraper', query }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! Google Maps failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: OpenStreetMap (Overpass API)
  const osm = config.openStreetMap || {};
  if (osm.enabled) {
    for (const city of osm.cities || []) {
      console.log(`[normal] OpenStreetMap: "${city}"`);
      try {
        const leads = await scrapeOpenStreetMap(city);
        allLeads.push(...tag(leads, { source: 'openstreetmap', engine: 'normal_scraper', query: city }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! OSM failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: GitHub Organizations (free REST API)
  const githubOrgs = config.githubOrgs || {};
  if (githubOrgs.enabled) {
    for (const location of githubOrgs.locations || []) {
      console.log(`[normal] GitHub Orgs: "${location}"`);
      try {
        const token = githubOrgs.token || process.env.GITHUB_TOKEN || '';
        const leads = await scrapeGithubOrgs(location, { token, maxResults: githubOrgs.maxResults });
        allLeads.push(...tag(leads, { source: 'github_orgs', engine: 'normal_scraper', query: location }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! GitHub Orgs failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: OpenCorporates (opt-in, needs config.openCorporates.apiToken)
  const openCorporates = config.openCorporates || {};
  if (openCorporates.enabled) {
    for (const query of openCorporates.searches || []) {
      console.log(`[normal] OpenCorporates: "${query}"`);
      try {
        const leads = await scrapeOpenCorporates(openCorporates.jurisdiction || 'pk', query, {
          apiToken: openCorporates.apiToken,
          maxResults: openCorporates.maxResults,
        });
        allLeads.push(...tag(leads, { source: 'opencorporates', engine: 'normal_scraper', query }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! OpenCorporates failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: PSEB / TechDestination member directory
  const pseb = config.pseb || {};
  if (pseb.enabled) {
    console.log('[normal] PSEB/TechDestination');
    try {
      const leads = await scrapePseb();
      allLeads.push(...tag(leads, { source: 'pseb', engine: 'normal_scraper', query: 'techdestination profiles' }));
      console.log(`  -> ${leads.length} leads\n`);
    } catch (err) {
      console.error(`  !! PSEB failed: ${err.message.split('\n')[0]}\n`);
    }
  }

  // Source: TopDevelopers.co
  const topDevelopers = config.topDevelopers || {};
  if (topDevelopers.enabled) {
    for (const category of topDevelopers.categories || []) {
      console.log(`[normal] TopDevelopers: "${category}"`);
      try {
        const leads = await scrapeTopDevelopers(category, topDevelopers.maxPages || 2);
        allLeads.push(...tag(leads, { source: 'topdevelopers', engine: 'normal_scraper', query: category }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! TopDevelopers failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: Eventbrite tech-event organizers
  const eventbrite = config.eventbrite || {};
  if (eventbrite.enabled) {
    for (const search of eventbrite.searches || []) {
      console.log(`[normal] Eventbrite: "${search.query}" / "${search.location}"`);
      try {
        const leads = await scrapeEventbrite(search.query, search.location, { concurrency: eventbrite.concurrency });
        allLeads.push(...tag(leads, { source: 'eventbrite', engine: 'normal_scraper', query: `${search.query}/${search.location}` }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! Eventbrite failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // === CLOAK BROWSER (stealth Chromium for anti-bot-protected directories) ===

  // Source: Clutch.co
  const clutch = config.clutch || {};
  if (clutch.enabled) {
    for (const dir of clutch.directories || []) {
      console.log(`[cloak] Clutch: "${dir}"`);
      try {
        const leads = await scrapeClutch(dir, cloak, clutch.maxPages || 2);
        allLeads.push(...tag(leads, { source: 'clutch', engine: 'cloak_browser', query: dir }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! Clutch failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: GoodFirms
  const goodFirms = config.goodFirms || {};
  if (goodFirms.enabled) {
    for (const dir of goodFirms.directories || []) {
      console.log(`[cloak] GoodFirms: "${dir}"`);
      try {
        const leads = await scrapeGoodFirms(dir, cloak, goodFirms.maxPages || 2);
        allLeads.push(...tag(leads, { source: 'goodfirms', engine: 'cloak_browser', query: dir }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! GoodFirms failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: Sortlist — supports { queries: [{category, country}] } or legacy { categories: [...] }
  const sortlist = config.sortlist || {};
  if (sortlist.enabled) {
    const sortlistQueries = sortlist.queries
      ? sortlist.queries
      : (sortlist.categories || []).map((c) => ({ category: c, country: '' }));
    for (const q of sortlistQueries) {
      const label = q.country ? `${q.country}/${q.category}` : q.category;
      console.log(`[cloak] Sortlist: "${label}"`);
      try {
        const leads = await scrapeSortlist(q.category, cloak, q.country || '');
        allLeads.push(...tag(leads, { source: 'sortlist', engine: 'cloak_browser', query: label }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! Sortlist failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // Source: DesignRush — supports { queries: [{category, country}] } or legacy { categories: [...] }
  const designRush = config.designRush || {};
  if (designRush.enabled) {
    const designRushQueries = designRush.queries
      ? designRush.queries
      : (designRush.categories || []).map((c) => ({ category: c, country: '' }));
    for (const q of designRushQueries) {
      const label = q.country ? `${q.category}?country=${q.country}` : q.category;
      console.log(`[cloak] DesignRush: "${label}"`);
      try {
        const leads = await scrapeDesignRush(q.category, cloak, q.country || '');
        allLeads.push(...tag(leads, { source: 'designrush', engine: 'cloak_browser', query: label }));
        console.log(`  -> ${leads.length} leads\n`);
      } catch (err) {
        console.error(`  !! DesignRush failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  allLeads = dedupe(allLeads);
  console.log(`${allLeads.length} unique leads after dedupe`);

  allLeads = filterByIcp(allLeads, config);
  console.log(`${allLeads.length} leads after ICP/category filter`);

  if (config.findEmails) {
    console.log('Crawling company websites for emails and social links...');
    await enrichLeads(allLeads, 15);
    const withEmail = allLeads.filter((l) => l.email).length;
    console.log(`  -> ${withEmail}/${allLeads.length} leads have an email`);

    console.log('Verifying email domains (MX check)...');
    await verifyLeads(allLeads);
    const alive = allLeads.filter((l) => l.email_verified === 'alive').length;
    const dead = allLeads.filter((l) => l.email_verified === 'dead').length;
    console.log(`  -> ${alive} alive, ${dead} dead, ${withEmail - alive - dead} unknown`);
  }

  allLeads = filterByContactPoint(allLeads);
  console.log(`${allLeads.length} leads after contact-point filter`);

  // Score the current batch (for the per-run CSV)
  console.log('Scoring leads...');
  scoreLeads(allLeads);
  allLeads.sort((a, b) => (b.score || 0) - (a.score || 0));

  // --- Per-run file ---
  const label = config.runLabel ? `-${config.runLabel}` : '';
  const runFile = resolve(root, `output/runs/leads-${runTimestamp()}${label}.csv`);
  mkdirSync(dirname(runFile), { recursive: true });
  const runWritten = await writeCsv(allLeads, runFile);
  console.log(`\nRun file:    ${allLeads.length} leads → ${runWritten}`);

  // --- Master file (all runs merged + deduped + re-scored) ---
  // Re-score the ENTIRE master after merge so existing leads always reflect
  // the latest scorer logic and never keep stale/empty scores from old runs.
  const masterJson = resolve(root, 'output/master.json');
  const masterCsv  = resolve(root, 'output/leads-master.csv');
  const existing   = pruneExpired(loadMasterJson(masterJson), 30);
  const merged     = mergeMaster(existing, allLeads);
  console.log('Re-scoring master...');
  scoreLeads(merged);
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  writeFileSync(masterJson, JSON.stringify(merged, null, 2), 'utf8');
  const masterWritten = await writeCsv(merged, masterCsv);
  console.log(`Master file: ${merged.length} total leads → ${masterWritten}`);

  // --- Sync full deduped master to Supabase (frontend reads from here) ---
  console.log('Syncing leads to Supabase...');
  await syncLeadsToSupabase(merged);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
