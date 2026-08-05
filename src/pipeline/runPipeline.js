// The shared lead-quality pipeline: clean -> dedupe -> ICP filter -> (optional)
// email enrichment -> MX verify -> contact-point filter -> dead-email filter ->
// score -> score floor. Pure lead-array transform, no file writes or DB calls,
// so it can run over any source of raw leads — the weekly config-driven scrape
// (src/index.js) today, on-demand url/firm-name lookups later (roadmap Phase 2).
import { spawnSync } from 'child_process';
import { enrichLeads } from '../scrapers/emailFinder.js';
import { filterByIcp, filterByContactPoint, filterByDeadEmailOnly, filterByScore } from '../quality/qualityFilter.js';
import { verifyLeads } from '../quality/emailVerifier.js';
import { scoreLeads } from '../quality/scorer.js';
import { classifyLeads } from '../quality/classifier.js';
import { normalizeFirmographics } from '../quality/firmographics.js';
import { resolveRegions } from '../quality/geography.js';
import { cleanLead } from '../lib/cleanLead.js';
import { dedupeKey } from '../lib/normalizeUrl.js';
import { CSV_COLUMNS } from '../lib/leadFields.js';

// Merge-dedup: for each unique company key, merge all scraped versions so
// the final lead has the richest possible set of fields (e.g. Clutch provides
// rating/company_size while GitHub provides email — both survive).
export function dedupe(leads) {
  const byKey = new Map();
  for (const lead of leads) {
    const key = dedupeKey(lead);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { ...lead });
    } else {
      const base = byKey.get(key);
      for (const [field] of CSV_COLUMNS) {
        if (!base[field] && lead[field]) base[field] = lead[field];
      }
    }
  }
  const merged = [...byKey.values()];
  const dropped = leads.length - merged.length;
  if (dropped > 0) console.log(`  ${dropped} duplicate leads merged`);
  return merged;
}

/**
 * opts:
 *   config      - loaded config.json (ICP keywords, quality.minScore)
 *   findEmails  - whether to run website/ScrapegraphAI enrichment + MX verify
 *                 (defaults to config.findEmails)
 *   pythonBin   - resolved python executable, or null to skip ScrapegraphAI
 *   scrapegraph - config.scrapegraph block (defaults to config.scrapegraph)
 */
export async function runPipeline(rawLeads, opts = {}) {
  const {
    config = {},
    findEmails = config.findEmails,
    pythonBin = null,
    scrapegraph = config.scrapegraph || {},
  } = opts;

  let leads = [...rawLeads];

  // Sanitise every field: decode %20, strip HTML tags/entities, normalise whitespace
  leads.forEach(cleanLead);
  console.log('Cleaned raw scraper output.');

  leads = dedupe(leads);
  console.log(`${leads.length} unique leads after dedupe`);

  leads = filterByIcp(leads, config);
  console.log(`${leads.length} leads after ICP/category filter`);

  if (findEmails) {
    console.log('Crawling company websites for emails and social links...');
    await enrichLeads(leads, 15);
    const withEmail = leads.filter((l) => l.email).length;
    console.log(`  -> ${withEmail}/${leads.length} leads have an email`);

    // Re-clean after enrichment: emails crawled from websites can also
    // contain URL-encoded characters or HTML entity artifacts.
    leads.forEach(cleanLead);

    // ScrapegraphAI enrichment — for leads emailFinder couldn't find an email for.
    // Sends the full lead array; Python returns the same array with gaps filled.
    if (scrapegraph.enabled && pythonBin && scrapegraph.enrichment?.enabled !== false) {
      const stillMissing = leads.filter((l) => l.website && !l.email).length;
      console.log(`[scrapegraph] Enriching ${stillMissing} leads still without email...`);
      const sgEnrich = spawnSync(pythonBin, ['src/scrapers/scrapegraph_enricher.py', 'enrich'], {
        input: JSON.stringify(leads),
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
        env: { ...process.env },
      });
      if (sgEnrich.stderr) process.stderr.write(sgEnrich.stderr);
      if (sgEnrich.status === 0 && sgEnrich.stdout?.trim()) {
        try {
          const enriched = JSON.parse(sgEnrich.stdout);
          if (Array.isArray(enriched) && enriched.length === leads.length) {
            leads = enriched;
            leads.forEach(cleanLead); // clean any LLM artifacts
            const gotEmail = leads.filter((l) => l.email).length;
            console.log(`[scrapegraph] Enrichment done — ${gotEmail}/${leads.length} leads now have email\n`);
          }
        } catch (e) {
          console.error('[scrapegraph] enrichment JSON parse error:', e.message);
        }
      } else if (sgEnrich.status !== 0) {
        console.error('[scrapegraph] enricher exited with status', sgEnrich.status);
      }
    }

    console.log('Verifying email domains (MX check)...');
    await verifyLeads(leads);
    const alive = leads.filter((l) => l.email_verified === 'alive').length;
    const dead = leads.filter((l) => l.email_verified === 'dead').length;
    console.log(`  -> ${alive} alive, ${dead} dead, ${withEmail - alive - dead} unknown`);
  }

  leads = filterByContactPoint(leads);
  console.log(`${leads.length} leads after contact-point filter`);

  leads = filterByDeadEmailOnly(leads);
  console.log(`${leads.length} leads after dead-email-only filter`);

  console.log('Classifying leads (rules pass)...');
  classifyLeads(leads);
  normalizeFirmographics(leads);
  resolveRegions(leads);

  // Score the current batch
  console.log('Scoring leads...');
  scoreLeads(leads);

  // Drop Tier D noise — leads with score < 35 have too little data to be actionable
  const minScore = config.quality?.minScore ?? 35;
  leads = filterByScore(leads, minScore);
  console.log(`${leads.length} leads after score floor (>= ${minScore})`);

  leads.sort((a, b) => (b.score || 0) - (a.score || 0));

  return leads;
}
