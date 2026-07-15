import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

// Read-only client for the dashboard — uses the publishable/anon key, safe
// for server components. Writes are RLS-blocked; only the scraper's
// service_role key (never shipped here) can write.
export function getSupabaseClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
