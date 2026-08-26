// One-shot: recompute region/country/city for every existing lead in
// Supabase from its address/search_query — needed because
// src/quality/geography.js's resolveRegions()/resolveGeos() only run inside
// the scrape pipeline (src/pipeline/runPipeline.js), so leads scraped before
// country/city existed (or before the region word-boundary fix landed) never
// get either without a pass like this one.
//
// Also re-resolves `region` (not just the new country/city fields) since the
// same pass fixed a real bug: resolveRegion() used to do plain substring
// matching, so the keyword "kl" (Kuala Lumpur) matched inside "Brooklyn" and
// "Parkland" — see memory.md. Leads already tagged region from that buggy
// pass need to be corrected here, not just filled in where null.
//
// Run: node scripts/backfill-geo.js          # apply changes
//      node scripts/backfill-geo.js --dry-run # report what would change, write nothing
import 'dotenv/config';
import { getSupabaseClient } from '../src/lib/supabaseClient.js';
import { resolveRegion, resolveGeo } from '../src/quality/geography.js';

const PAGE_SIZE = 1000;
const CONCURRENCY = 20;
const dryRun = process.argv.includes('--dry-run');

async function fetchAll(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, address, search_query, region, country, city')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing).');
    process.exit(1);
  }

  console.log('Loading leads...');
  const rows = await fetchAll(supabase);
  console.log(`  ${rows.length} leads loaded`);

  const updates = [];
  let regionChanged = 0;
  let countryFilled = 0;
  let cityFilled = 0;

  for (const row of rows) {
    const lead = { address: row.address, search_query: row.search_query };
    const region = resolveRegion(lead);
    const { country, city } = resolveGeo(lead);

    if (region !== row.region || country !== row.country || city !== row.city) {
      updates.push({ id: row.id, region, country, city });
      if (region !== row.region) regionChanged++;
      if (country && !row.country) countryFilled++;
      if (city && !row.city) cityFilled++;
    }
  }

  console.log(`  ${updates.length} leads need an update`);
  console.log(`    region corrected (word-boundary fix): ${regionChanged}`);
  console.log(`    country newly resolved: ${countryFilled}`);
  console.log(`    city newly resolved: ${cityFilled}`);

  if (dryRun) {
    console.log('\n--dry-run: no changes written.');
    return;
  }

  const queue = [...updates];
  let done = 0;
  let failed = 0;
  async function worker() {
    while (queue.length > 0) {
      const { id, region, country, city } = queue.shift();
      const { error } = await supabase.from('leads').update({ region, country, city }).eq('id', id);
      if (error) {
        failed++;
        console.error(`\n  !! update failed for id=${id}: ${error.message}`);
      }
      done++;
      process.stdout.write(`  Updated ${done}/${updates.length}...\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone — ${updates.length - failed}/${updates.length} leads updated${failed ? `, ${failed} FAILED` : ''}.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
