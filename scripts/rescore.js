/**
 * One-shot: read leads-master.csv, re-score every lead, rewrite both files.
 * Run: node scripts/rescore.js
 *
 * Lives in scripts/ with the other one-shot tools (backfill-supabase.js,
 * ingest-run-csv.js, export-all-leads.js) rather than at the repo root.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scoreLeads } from '../src/quality/scorer.js';

// '..' because this file sits in scripts/, not the repo root.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const masterCsv  = resolve(root, 'output/leads-master.csv');
const masterJson = resolve(root, 'output/master.json');

// ── CSV parser ──────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur); return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

// CSV uses column header names; scorer uses internal field names.
// Map: internal → csv header
const CSV_COLUMNS = [
  ['name',         'company_name'],
  ['category',     'category'],
  ['website',      'website'],
  ['email',        'email'],
  ['all_emails',   'all_emails'],
  ['phone',        'phone'],
  ['address',      'address'],
  ['linkedin',     'linkedin'],
  ['facebook',     'facebook'],
  ['instagram',    'instagram'],
  ['rating',       'rating'],
  ['reviews',      'review_count'],
  ['company_size', 'company_size'],
  ['hourly_rate',  'hourly_rate'],
  ['min_project',  'min_project'],
  ['search_query', 'search_query'],
  ['maps_url',     'profile_url'],
  ['source',       'source'],
  ['engine',       'engine'],
  ['email_verified','email_verified'],
  ['score',        'score'],
  ['tier',         'tier'],
  ['scraped_at',   'scraped_at'],
];

// Build lookup: csv header → internal name
const csvToInternal = Object.fromEntries(CSV_COLUMNS.map(([int, csv]) => [csv, int]));

if (!existsSync(masterCsv)) {
  console.error('output/leads-master.csv not found.');
  process.exit(1);
}

// Read CSV (fields use CSV header names like company_name, review_count)
const csvRows = parseCsv(readFileSync(masterCsv, 'utf8'));
console.log(`Loaded ${csvRows.length} leads from leads-master.csv`);

// Convert CSV rows to internal field names (scorer expects 'name', 'reviews', etc.)
const leads = csvRows.map(row => {
  const lead = {};
  for (const [csvHeader, val] of Object.entries(row)) {
    const internal = csvToInternal[csvHeader] ?? csvHeader;
    lead[internal] = val;
  }
  return lead;
});

// Re-score
scoreLeads(leads);
leads.sort((a, b) => (b.score || 0) - (a.score || 0));

// Write master.json (internal field names)
writeFileSync(masterJson, JSON.stringify(leads, null, 2), 'utf8');
console.log(`Saved output/master.json`);

// Write master CSV (csv header names)
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
const header = CSV_COLUMNS.map(([, h]) => h).join(',');
const rows   = leads.map(l => CSV_COLUMNS.map(([id]) => esc(l[id])).join(','));
writeFileSync(masterCsv, [header, ...rows].join('\r\n') + '\r\n', 'utf8');
console.log(`Saved output/leads-master.csv (${leads.length} rows)`);
