import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { scrapeGoogleMaps } from './scrapers/googleMaps.js';
import { scrapeOpenStreetMap } from './scrapers/openStreetMap.js';
import { enrichLeads } from './scrapers/emailFinder.js';

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
  ['rating', 'google_rating'],
  ['reviews', 'review_count'],
  ['search_query', 'search_query'],
  ['maps_url', 'maps_url'],
  ['source', 'source'],
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

function dedupe(leads) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = (lead.website || lead.name).toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  console.log('Lead scraper starting\n');
  let allLeads = [];

  // --- Source 1: Google Maps ---
  const gmaps = config.googleMaps || {};
  if (gmaps.enabled) {
    for (const query of gmaps.searches || []) {
      console.log(`Scraping Google Maps: "${query}"`);
      try {
        const leads = await scrapeGoogleMaps(query, gmaps.maxResultsPerSearch, gmaps.headless);
        for (const lead of leads) {
          lead.search_query = query;
          lead.source = 'google_maps';
          lead.scraped_at = new Date().toISOString();
        }
        allLeads.push(...leads);
        console.log(`  -> ${leads.length} leads collected\n`);
      } catch (err) {
        console.error(`  !! Search failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  // --- Source 2: OpenStreetMap (Overpass API) ---
  const osm = config.openStreetMap || {};
  if (osm.enabled) {
    for (const city of osm.cities || []) {
      console.log(`Querying OpenStreetMap: "${city}"`);
      try {
        const leads = await scrapeOpenStreetMap(city);
        for (const lead of leads) {
          lead.search_query = city;
          lead.source = 'openstreetmap';
          lead.scraped_at = new Date().toISOString();
        }
        allLeads.push(...leads);
        console.log(`  -> ${leads.length} leads collected\n`);
      } catch (err) {
        console.error(`  !! OSM query failed: ${err.message.split('\n')[0]}\n`);
      }
    }
  }

  allLeads = dedupe(allLeads);
  console.log(`${allLeads.length} unique leads after dedupe`);

  if (config.findEmails) {
    console.log('Crawling company websites for emails and social links...');
    await enrichLeads(allLeads);
    const withEmail = allLeads.filter((l) => l.email).length;
    console.log(`  -> ${withEmail}/${allLeads.length} leads have an email`);
  }

  const outPath = resolve(root, config.outputFile);
  mkdirSync(dirname(outPath), { recursive: true });

  const written = await writeCsv(allLeads, outPath);
  console.log(`\nDone. ${allLeads.length} leads written to ${written}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
