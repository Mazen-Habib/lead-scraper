// Exports the ENTIRE live leads table from Supabase to output/all.csv — the
// single guaranteed-complete snapshot the user asked for after the Aug 2026
// incident where a partial Supabase sync silently lost ~2,489 leads.
//
// Distinct from output/leads-master.csv: that file is the pre-sync in-memory
// view built during a scrape run (30-day-pruned, may not reflect everything
// Supabase actually holds). This reads Supabase itself, after sync, so it's
// the authoritative "here is everything, guaranteed" file — regenerated and
// committed after every weekly run (see .github/workflows/weekly-scrape.yml
// and weekly-scrape-general.yml).
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchMasterFromSupabase } from '../src/lib/pushToSupabase.js';
import { toCsv } from '../src/lib/csv.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  console.log('Exporting the complete leads table from Supabase...');
  // Reuses fetchMasterFromSupabase as-is — it already paginates the whole
  // table and maps rows back to the internal-field shape toCsv() expects, so
  // there's no second fetch/mapping implementation to keep in sync.
  const leads = await fetchMasterFromSupabase();
  if (leads.length === 0) {
    console.error('No leads returned — check SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set. Not overwriting output/all.csv with an empty file.');
    process.exit(1);
  }

  const outPath = resolve(root, 'output/all.csv');
  writeFileSync(outPath, toCsv(leads), 'utf8');
  console.log(`Exported ${leads.length} leads -> ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
