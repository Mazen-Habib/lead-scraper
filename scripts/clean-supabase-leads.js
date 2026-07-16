/**
 * One-off cleanup: reads every lead already in Supabase, runs cleanLead()
 * on all fields, then upserts the cleaned records back.
 * Run once to fix existing %20 / HTML-entity / stray-tag artifacts.
 *
 *   node scripts/clean-supabase-leads.js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { cleanLead } from '../src/lib/cleanLead.js';

const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PAGE = 1000;

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Map DB column names → cleanLead field names where they differ
function dbRowToLead(row) {
  return {
    name:           row.company_name,
    company_name:   row.company_name,
    category:       row.category,
    website:        row.website,
    email:          row.email,
    all_emails:     row.all_emails,
    phone:          row.phone,
    address:        row.address,
    linkedin:       row.linkedin,
    facebook:       row.facebook,
    instagram:      row.instagram,
    rating:         row.rating != null ? String(row.rating) : '',
    reviews:        row.review_count != null ? String(row.review_count) : '',
    review_count:   row.review_count != null ? String(row.review_count) : '',
    company_size:   row.company_size,
    hourly_rate:    row.hourly_rate,
    min_project:    row.min_project,
    search_query:   row.search_query,
    maps_url:       row.profile_url,
    profile_url:    row.profile_url,
    source:         row.source,
    engine:         row.engine,
    email_verified: row.email_verified,
    score:          row.score != null ? String(row.score) : '',
    tier:           row.tier,
    scraped_at:     row.scraped_at,
  };
}

function leadToDbRow(lead) {
  const scoreNum = parseInt(lead.score) || null;
  const ratingNum = parseFloat(lead.rating) || null;
  const reviewNum = parseInt(lead.review_count || lead.reviews) || null;
  const key = (lead.website || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0].split('?')[0].toLowerCase()
    || (lead.company_name || lead.name || '').trim().toLowerCase();

  return {
    dedupe_key:    key,
    company_name:  lead.company_name || lead.name || '',
    category:      lead.category     || '',
    website:       lead.website      || '',
    email:         lead.email        || '',
    all_emails:    lead.all_emails   || '',
    phone:         lead.phone        || '',
    address:       lead.address      || '',
    linkedin:      lead.linkedin     || '',
    facebook:      lead.facebook     || '',
    instagram:     lead.instagram    || '',
    rating:        ratingNum,
    review_count:  reviewNum,
    company_size:  lead.company_size || '',
    hourly_rate:   lead.hourly_rate  || '',
    min_project:   lead.min_project  || '',
    search_query:  lead.search_query || '',
    profile_url:   lead.profile_url  || lead.maps_url || '',
    source:        lead.source       || '',
    engine:        lead.engine       || '',
    email_verified:lead.email_verified || '',
    score:         scoreNum,
    tier:          lead.tier         || '',
    scraped_at:    lead.scraped_at   || new Date().toISOString(),
  };
}

async function main() {
  console.log('Fetching all leads from Supabase...');
  const rows = await fetchAll();
  console.log(`  ${rows.length} leads loaded.`);

  let cleaned = 0;
  const dbRows = rows.map((row) => {
    const lead = dbRowToLead(row);
    cleanLead(lead);
    cleaned++;
    return leadToDbRow(lead);
  });

  console.log(`Cleaned ${cleaned} leads. Upserting back to Supabase...`);

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < dbRows.length; i += BATCH) {
    const batch = dbRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('leads')
      .upsert(batch, { onConflict: 'dedupe_key' });
    if (error) throw new Error(`Upsert failed at batch ${i}: ${error.message}`);
    upserted += batch.length;
    process.stdout.write(`  ${upserted}/${dbRows.length} upserted...\r`);
  }

  console.log(`\nDone. ${upserted} leads cleaned and written back to Supabase.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
