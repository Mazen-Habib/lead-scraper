import { getSupabaseClient } from './supabaseClient.js';
import { dedupeKey } from './normalizeUrl.js';

const BATCH_SIZE = 500;

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
  };
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
