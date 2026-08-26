// One-shot: compute lead_type (buyer/vendor) for every existing lead in
// Supabase from its source/search_query/category — needed because
// classifyLeadTypes() only runs inside the scrape pipeline
// (src/pipeline/runPipeline.js), so leads scraped before lead_type existed
// never get it without a pass like this one. See src/quality/leadType.js
// for what "buyer" and "vendor" mean here.
//
// Run: node scripts/backfill-lead-type.js          # apply changes
//      node scripts/backfill-lead-type.js --dry-run # report only
import 'dotenv/config';
import { getSupabaseClient } from '../src/lib/supabaseClient.js';
import { classifyLeadType } from '../src/quality/leadType.js';

const PAGE_SIZE = 1000;
const CONCURRENCY = 20;
const dryRun = process.argv.includes('--dry-run');

async function fetchAll(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, source, search_query, category, lead_type')
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
  let buyer = 0;
  let vendor = 0;
  let unknown = 0;

  for (const row of rows) {
    const leadType = classifyLeadType(row);
    if (leadType !== row.lead_type) updates.push({ id: row.id, lead_type: leadType });
    if (leadType === 'buyer') buyer++;
    else if (leadType === 'vendor') vendor++;
    else unknown++;
  }

  console.log(`  ${updates.length} leads need an update`);
  console.log(`    buyer: ${buyer}  vendor: ${vendor}  unknown: ${unknown}`);

  if (dryRun) {
    console.log('\n--dry-run: no changes written.');
    return;
  }

  const queue = [...updates];
  let done = 0;
  let failed = 0;
  async function worker() {
    while (queue.length > 0) {
      const { id, lead_type } = queue.shift();
      const { error } = await supabase.from('leads').update({ lead_type }).eq('id', id);
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
