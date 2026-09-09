// One-shot: repair phone numbers already stored in Supabase that don't parse
// as valid numbers.
//
// Why this exists — measured on production 2026-09-09: of 12,400 leads with a
// phone, 11,658 (94.0%) parse as valid and 742 (6.0%) do not. Inspecting the
// failures, most are not bad data at all — they're several real numbers
// crammed into one field by the source scraper:
//
//   "052 3251970, +92 -21-9 9264222"
//   "9221-111987789 / 2563524 / 2563520, +92 (021)-32563520-4"
//   "+234 1 4405145 , +234 1 2796666, +234-818-000-6245"
//
// libphonenumber rejects the whole string, so the lead reads as unreachable
// by phone even though a perfectly good number is sitting in there. That
// matters more than it sounds: for this lead population (small local
// businesses, whose websites almost never name an individual — see
// memory.md's 2026-09-09 entry) the phone IS the reachable channel.
//
// Deliberately reuses extractPhoneNumbers() from src/lib/phoneExtract.js
// rather than writing new parsing: it was built to pull numbers out of messy
// page text, which is exactly this problem, and it already has tests. Spot
// checked against the real failures above — it recovers 5 of 7 into clean
// E.164. The 2 it doesn't are genuinely broken (a too-short Nigerian number,
// and a US-format number tagged as Egyptian).
//
// Only ever rewrites a phone that does NOT currently parse. A valid stored
// number is never touched, so this cannot regress good data.
//
// Run: node scripts/backfill-phones.js --dry-run   # report only, writes nothing
//      node scripts/backfill-phones.js             # apply
import 'dotenv/config';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getSupabaseClient } from '../src/lib/supabaseClient.js';
import { extractPhoneNumbers, resolveDefaultCountryIso2 } from '../src/lib/phoneExtract.js';

const PAGE_SIZE = 1000;
const CONCURRENCY = 20;
const dryRun = process.argv.includes('--dry-run');

function isValid(phone, iso) {
  if (!phone) return false;
  try {
    const p = parsePhoneNumberFromString(phone, iso || undefined);
    return !!p && p.isValid();
  } catch {
    return false;
  }
}

async function fetchAll(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, country')
      .not('phone', 'is', null)
      .neq('phone', '')
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

  console.log('Loading leads with a phone...');
  const rows = await fetchAll(supabase);
  console.log(`  ${rows.length} leads have a phone`);

  const updates = [];
  let alreadyValid = 0;
  let unrecoverable = 0;

  for (const row of rows) {
    const iso = resolveDefaultCountryIso2(row.country);
    if (isValid(row.phone, iso)) {
      alreadyValid++;
      continue;
    }
    const [recovered] = extractPhoneNumbers(row.phone, iso);
    // Only accept a recovery that itself parses — extractPhoneNumbers already
    // validates, but re-checking here means this script can never write
    // something it wouldn't itself consider valid on the next run.
    if (recovered && recovered !== row.phone && isValid(recovered, iso)) {
      updates.push({ id: row.id, phone: recovered, was: row.phone });
    } else {
      unrecoverable++;
    }
  }

  console.log(`  ${alreadyValid} already valid (untouched)`);
  console.log(`  ${updates.length} repairable`);
  console.log(`  ${unrecoverable} genuinely unparseable (left as-is)`);

  if (updates.length > 0) {
    console.log('\n  sample repairs:');
    for (const u of updates.slice(0, 8)) {
      console.log(`    ${u.was.slice(0, 44).padEnd(46)} -> ${u.phone}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: no changes written.');
    return;
  }
  if (updates.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  const queue = [...updates];
  let done = 0;
  let failed = 0;
  async function worker() {
    while (queue.length > 0) {
      const { id, phone } = queue.shift();
      const { error } = await supabase.from('leads').update({ phone }).eq('id', id);
      if (error) {
        failed++;
        console.error(`\n  !! update failed for id=${id}: ${error.message}`);
      }
      done++;
      process.stdout.write(`  Updated ${done}/${updates.length}...\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone — ${updates.length - failed}/${updates.length} phones repaired${failed ? `, ${failed} FAILED` : ''}.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
