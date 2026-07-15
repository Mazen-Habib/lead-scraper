// One-off backfill: merges the local master.json with any lead CSVs passed
// as CLI args (e.g. old runs recovered from another machine), re-scores the
// merged set, and upserts everything into Supabase.
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dedupeKey } from '../src/lib/normalizeUrl.js';
import { scoreLeads } from '../src/quality/scorer.js';
import { syncLeadsToSupabase } from '../src/lib/pushToSupabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  ['source', 'source'],
  ['engine', 'engine'],
  ['email_verified', 'email_verified'],
  ['score', 'score'],
  ['tier', 'tier'],
  ['scraped_at', 'scraped_at'],
];
const TITLE_TO_FIELD = new Map(CSV_COLUMNS.map(([field, title]) => [title, field]));

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const lead = {};
    headers.forEach((title, i) => {
      const field = TITLE_TO_FIELD.get(title.trim());
      if (field) lead[field] = values[i] ?? '';
    });
    return lead;
  });
}

function mergeAll(sets) {
  const byKey = new Map();
  let added = 0;
  for (const leads of sets) {
    for (const lead of leads) {
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
  }
  return { merged: [...byKey.values()], added };
}

async function main() {
  const sets = [];

  const masterJsonPath = resolve(root, 'output/master.json');
  if (existsSync(masterJsonPath)) {
    const existing = JSON.parse(readFileSync(masterJsonPath, 'utf8'));
    console.log(`Loaded ${existing.length} leads from output/master.json`);
    sets.push(existing);
  }

  for (const arg of process.argv.slice(2)) {
    const path = resolve(arg);
    if (!existsSync(path)) {
      console.warn(`  !! CSV not found, skipping: ${path}`);
      continue;
    }
    const leads = parseCsv(readFileSync(path, 'utf8'));
    console.log(`Loaded ${leads.length} leads from ${path}`);
    sets.push(leads);
  }

  const { merged, added } = mergeAll(sets);
  console.log(`\n${merged.length} unique leads after merge (from ${added} raw rows across ${sets.length} sources)`);

  scoreLeads(merged);
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log('Syncing to Supabase...');
  const { synced, skipped } = await syncLeadsToSupabase(merged);
  if (skipped) {
    console.error('Supabase not configured — check .env has SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  console.log(`Done: ${synced} leads synced.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
