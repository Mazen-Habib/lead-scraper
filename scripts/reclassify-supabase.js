// Re-runs the rules classifier over every lead in Supabase and reports (or
// applies) the differences. Written for the substring-matching bug fixed in
// classifier.js — leads tagged before that fix can carry an industry that was
// matched inside an unrelated word ("HairSense" -> ai-ml via "h·ai·rsense").
//
// DRY RUN BY DEFAULT. Pass --apply to write. Production writes are expected to
// be signed off explicitly, so nothing here touches the DB unless asked.
//
// Scope rules, and why:
//
//   tag_source 'rules'  RECLASSIFIED. These came from the buggy pass, so they
//                       are exactly the rows in question.
//
//   tag_source 'web'    LEFT ALONE. The web tagger only ran because the rules
//   tag_source 'llm'    pass came up empty, and it reads the company's actual
//                       site rather than a metadata string — a strictly better
//                       signal. Overwriting it with a rules guess would be a
//                       regression, even when the rules now produce something.
//
//   no tag_source,      RECLASSIFIED, but only ever to ADD an industry. These
//   no industry         are legacy rows; the taxonomy keywords added alongside
//                       the fix can now place some of them. Pure upside.
//
// Three outcomes are reported separately because they carry different risk:
//   CHANGED     — had an industry, now has a different one (the bug's victims)
//   CLEARED     — had an industry, now has none. Expected: a false positive
//                 removed. These become candidates for the web/LLM taggers,
//                 which is what should have happened originally.
//   GAINED      — had no industry, now has one (from the new keywords)
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchMasterFromSupabase, syncLeadsToSupabase } from '../src/lib/pushToSupabase.js';
import { classifyLead } from '../src/quality/classifier.js';
import { dedupeKey } from '../src/lib/normalizeUrl.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROTECTED_SOURCES = new Set(['web', 'llm']);

function main() {
  return run(process.argv.includes('--apply'));
}

async function run(apply) {
  const leads = await fetchMasterFromSupabase();
  if (leads.length === 0) {
    console.error('No leads returned — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.');
    process.exit(1);
  }

  const changed = [];
  const cleared = [];
  const gained = [];
  let skippedProtected = 0;
  let unchanged = 0;

  for (const lead of leads) {
    if (PROTECTED_SOURCES.has(lead.tag_source)) {
      skippedProtected++;
      continue;
    }

    const before = lead.industry || null;
    // classifyLead reads `name`/`category`/`website`/`maps_url`; Supabase rows
    // use the DB column titles, so bridge the two before classifying.
    const view = {
      name: lead.name || lead.company_name,
      category: lead.category,
      website: lead.website,
      search_query: lead.search_query,
      maps_url: lead.maps_url || lead.profile_url,
    };
    const result = classifyLead(view);
    const after = result.industry || null;

    if (before === after) {
      unchanged++;
      continue;
    }

    const row = {
      lead,
      before,
      after,
      name: view.name,
      category: lead.category,
      confidence: result.confidence,
      tags: result.tags,
      sub_industries: result.sub_industries,
    };

    if (before && after) changed.push(row);
    else if (before && !after) cleared.push(row);
    else gained.push(row);
  }

  const report = (label, rows, limit = 12) => {
    console.log(`\n${label}: ${rows.length}`);
    for (const r of rows.slice(0, limit)) {
      const name = String(r.name || '').slice(0, 30).padEnd(32);
      const cat = String(r.category || '').slice(0, 20).padEnd(22);
      console.log(`  ${name} ${cat} ${String(r.before)} -> ${String(r.after)}`);
    }
    if (rows.length > limit) console.log(`  ... and ${rows.length - limit} more`);
  };

  console.log(`\n${leads.length} leads in Supabase`);
  console.log(`  ${skippedProtected} skipped (tag_source web/llm — better signal, left alone)`);
  console.log(`  ${unchanged} unchanged`);

  report('CHANGED  (wrong industry -> different industry)', changed);
  report('CLEARED  (false positive removed, now unclassified)', cleared);
  report('GAINED   (newly classified by the added keywords)', gained);

  const total = changed.length + cleared.length + gained.length;
  console.log(`\n${total} of ${leads.length} leads would be updated (${(100 * total / leads.length).toFixed(1)}%)`);

  // A breakdown of which buckets are losing rows makes the bug's shape visible:
  // the substring victims should be concentrated in the short-keyword buckets.
  const lostBy = {};
  for (const r of [...changed, ...cleared]) {
    lostBy[r.before] = (lostBy[r.before] || 0) + 1;
  }
  console.log('\nIndustries losing leads (the buggy tags):');
  Object.entries(lostBy)
    .sort((a, b) => b[1] - a[1])
    .forEach(([slug, n]) => console.log(`  ${String(n).padStart(5)}  ${slug}`));

  if (!apply) {
    const outPath = resolve(root, 'output/reclassify-preview.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        { changed: changed.map(strip), cleared: cleared.map(strip), gained: gained.map(strip) },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\nDRY RUN — nothing written to Supabase.`);
    console.log(`Full diff: ${outPath}`);
    console.log(`Re-run with --apply to write these ${total} updates.`);
    return;
  }

  // --apply: mutate the lead objects and push the whole set back, reusing the
  // same retry/recovery-CSV path the scrape uses so a partial failure is loud
  // and recoverable rather than silent.
  for (const r of [...changed, ...cleared, ...gained]) {
    r.lead.industry = r.after;
    r.lead.tags = r.tags;
    r.lead.sub_industries = r.sub_industries;
    r.lead.tag_confidence = r.confidence;
    r.lead.tag_source = r.after ? 'rules' : null;
  }

  // Collapse rows that share a RECOMPUTED dedupe_key before syncing. Two rows
  // can sit in Supabase under distinct stored keys yet collapse to the same key
  // once toRow() recomputes it on the way back in — at which point Postgres
  // rejects the whole batch with "ON CONFLICT DO UPDATE command cannot affect
  // row a second time". One duplicate pair took down a 500-row batch on the
  // first apply, so this is not a theoretical guard.
  //
  // Keeping the first occurrence is safe here: this job only rewrites
  // classification fields, so the survivors carry the same corrected tags the
  // duplicates would have. Merging duplicate rows is a separate concern —
  // see scripts/clean-supabase-leads.js.
  const byKey = new Map();
  for (const lead of leads) {
    const key = dedupeKey(lead);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, lead);
  }
  const toSync = [...byKey.values()];
  const collapsed = leads.length - toSync.length;
  if (collapsed > 0) {
    console.log(`  ${collapsed} row(s) share a recomputed dedupe_key — syncing one per key`);
  }

  console.log(`\nApplying ${total} updates to Supabase...`);
  const { failed } = await syncLeadsToSupabase(toSync);
  if (failed > 0) {
    console.error(`\nFAILED: ${failed} lead(s) did not sync after retries.`);
    process.exitCode = 1;
  } else {
    console.log('Done — all leads synced.');
  }
}

// Keep the preview file readable: the full lead row is noise here.
function strip(r) {
  return { name: r.name, category: r.category, before: r.before, after: r.after };
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
