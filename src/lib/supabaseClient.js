import { createClient } from '@supabase/supabase-js';

let client = null;

// Returns null (rather than throwing) when credentials aren't configured, so
// local runs / CI runs without Supabase secrets still produce CSVs as before.
export function getSupabaseClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
