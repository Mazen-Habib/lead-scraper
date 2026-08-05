import { getSupabaseClient } from './supabaseClient.js';
import { dedupeKey } from './normalizeUrl.js';

const BATCH_SIZE = 500;
const SUPABASE_PAGE_SIZE = 1000; // PostgREST's default/max row cap per request

const MASTER_SELECT_COLUMNS =
  'company_name, category, website, email, all_emails, phone, address, linkedin, facebook, instagram, rating, review_count, company_size, hourly_rate, min_project, search_query, profile_url, source, engine, email_verified, score, tier, scraped_at, first_seen_at, last_seen_at, industry, tags, sub_industries, employee_count, firm_size_band, is_enterprise, tag_confidence, tag_source';

function toRow(lead) {
  const key = dedupeKey(lead);
  if (!key) return null;
  return {
    dedupe_key: key,
    company_name: lead.company_name || lead.name || null,
    category: lead.category || null,
    website: lead.website || null,
    email: lead.email || null,
    all_emails: lead.all_emails || null,
    phone: lead.phone || null,
    address: lead.address || null,
    linkedin: lead.linkedin || null,
    facebook: lead.facebook || null,
    instagram: lead.instagram || null,
    rating: lead.rating ? Number(lead.rating) || null : null,
    review_count: lead.review_count ? parseInt(lead.review_count, 10) || null : null,
    company_size: lead.company_size || null,
    hourly_rate: lead.hourly_rate || null,
    min_project: lead.min_project || null,
    search_query: lead.search_query || null,
    profile_url: lead.profile_url || lead.maps_url || null,
    source: lead.source || null,
    engine: lead.engine || null,
    email_verified: lead.email_verified || null,
    score: lead.score != null ? parseInt(lead.score, 10) || null : null,
    tier: lead.tier || null,
    scraped_at: lead.scraped_at || null,
    first_seen_at: lead.first_seen_at || null,
    last_seen_at: lead.last_seen_at || null,
    industry: lead.industry || null,
    tags: Array.isArray(lead.tags) ? lead.tags : null,
    sub_industries: Array.isArray(lead.sub_industries) ? lead.sub_industries : null,
    employee_count: lead.employee_count != null ? parseInt(lead.employee_count, 10) || null : null,
    firm_size_band: lead.firm_size_band || null,
    is_enterprise: !!lead.is_enterprise,
    tag_confidence: lead.tag_confidence != null ? Number(lead.tag_confidence) : null,
    tag_source: lead.tag_source || null,
  };
}

// Row shape → internal lead shape (inverse of toRow), matching the field
// names mergeMaster()/dedupeKey() expect (src/index.js CSV_COLUMNS).
function fromRow(row) {
  return {
    name: row.company_name || '',
    category: row.category || '',
    website: row.website || '',
    email: row.email || '',
    all_emails: row.all_emails || '',
    phone: row.phone || '',
    address: row.address || '',
    linkedin: row.linkedin || '',
    facebook: row.facebook || '',
    instagram: row.instagram || '',
    rating: row.rating != null ? String(row.rating) : '',
    reviews: row.review_count != null ? String(row.review_count) : '',
    company_size: row.company_size || '',
    hourly_rate: row.hourly_rate || '',
    min_project: row.min_project || '',
    search_query: row.search_query || '',
    maps_url: row.profile_url || '',
    source: row.source || '',
    engine: row.engine || '',
    email_verified: row.email_verified || '',
    score: row.score != null ? row.score : '',
    tier: row.tier || '',
    scraped_at: row.scraped_at || '',
    first_seen_at: row.first_seen_at || '',
    last_seen_at: row.last_seen_at || '',
    industry: row.industry || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    sub_industries: Array.isArray(row.sub_industries) ? row.sub_industries : [],
    employee_count: row.employee_count != null ? row.employee_count : null,
    firm_size_band: row.firm_size_band || null,
    is_enterprise: !!row.is_enterprise,
    tag_confidence: row.tag_confidence != null ? row.tag_confidence : null,
    tag_source: row.tag_source || null,
  };
}

// Reads the full current leads table so the scraper can merge new results
// into the real accumulated state instead of a master.json that CI never
// has (it's gitignored). Mirrors the frontend's fetchAllLeadRows pagination
// (free-nextjs-admin-dashboard-main/src/lib/leads.ts).
export async function fetchMasterFromSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const rows = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select(MASTER_SELECT_COLUMNS)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      console.error(`  !! Supabase fetchMaster failed: ${error.message}`);
      return [];
    }
    rows.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
  }
  console.log(`  Loaded ${rows.length} existing leads from Supabase master`);
  return rows.map(fromRow);
}

// Upserts leads into Supabase keyed on dedupe_key so re-running the scraper
// (or backfilling old CSVs) never creates duplicate rows — matching the same
// normalized-website/name key the in-process dedupe() uses.
export async function syncLeadsToSupabase(leads) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log('  Supabase not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing) — skipping DB sync.');
    return { synced: 0, skipped: true };
  }

  const rows = leads.map(toRow).filter(Boolean);
  let synced = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('leads').upsert(batch, { onConflict: 'dedupe_key' });
    if (error) {
      console.error(`  !! Supabase upsert failed for batch ${i / BATCH_SIZE + 1}: ${error.message}`);
      continue;
    }
    synced += batch.length;
  }
  console.log(`  Supabase: upserted ${synced}/${rows.length} leads`);
  return { synced, skipped: false };
}
