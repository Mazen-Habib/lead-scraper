/**
 * Filter smoke-test — runs two fast scrapers through the full quality pipeline
 * so we can verify filterByDeadEmailOnly and filterByScore actually fire.
 *
 *   node scripts/test-filters.js
 */
import 'dotenv/config';
import { scrapePseb } from '../src/scrapers/pseb.js';
import { scrapeTopDevelopers } from '../src/scrapers/topDevelopers.js';
import { scrapeGithubOrgs } from '../src/scrapers/githubOrgs.js';
import { enrichLeads } from '../src/scrapers/emailFinder.js';
import { verifyLeads } from '../src/quality/emailVerifier.js';
import { filterByIcp, filterByContactPoint, filterByDeadEmailOnly, filterByScore } from '../src/quality/qualityFilter.js';
import { scoreLeads } from '../src/quality/scorer.js';
import { cleanLead } from '../src/lib/cleanLead.js';
import { dedupeKey } from '../src/lib/normalizeUrl.js';

const MIN_SCORE = 35;

function dedupe(leads) {
  const seen = new Map();
  for (const l of leads) {
    const k = dedupeKey(l);
    if (k && !seen.has(k)) seen.set(k, l);
  }
  return [...seen.values()];
}

function banner(label, leads) {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  ${label}: ${leads.length} leads`);
}

async function main() {
  console.log('=== Filter smoke-test (PSEB + TopDevelopers/app-dev p1 + GitHub:Pakistan) ===\n');

  // ── 1. Scrape ────────────────────────────────────────────
  console.log('Scraping PSEB...');
  const psebLeads = await scrapePseb();
  console.log(`  PSEB: ${psebLeads.length} raw`);

  console.log('Scraping TopDevelopers (app-development, 1 page)...');
  const tdLeads = await scrapeTopDevelopers('app-development', { maxPages: 1 });
  console.log(`  TopDevelopers: ${tdLeads.length} raw`);

  console.log('Scraping GitHub Orgs (Pakistan, max 30)...');
  const token = process.env.GITHUB_TOKEN || '';
  const ghLeads = await scrapeGithubOrgs('Pakistan', { token, maxResults: 30 });
  console.log(`  GitHub: ${ghLeads.length} raw`);

  let leads = [...psebLeads, ...tdLeads, ...ghLeads];
  banner('0. Raw scraped', leads);

  // ── 2. Clean ─────────────────────────────────────────────
  leads.forEach(cleanLead);
  console.log('  cleanLead() applied to all');

  // ── 3. Dedupe ────────────────────────────────────────────
  leads = dedupe(leads);
  banner('1. After dedupe', leads);

  // ── 4. ICP filter ────────────────────────────────────────
  leads = filterByIcp(leads);
  banner('2. After ICP filter', leads);

  // ── 5. Email enrichment ───────────────────────────────────
  console.log('\nEmail enrichment (max 8 concurrent)...');
  leads = await enrichLeads(leads, { maxConcurrent: 8 });
  const withEmail = leads.filter((l) => l.email).length;
  banner(`3. After enrichment (${withEmail} have email)`, leads);

  // ── 6. Re-clean after enrichment ──────────────────────────
  leads.forEach(cleanLead);

  // ── 7. MX verification ────────────────────────────────────
  console.log('\nMX verification...');
  leads = await verifyLeads(leads);
  const alive = leads.filter((l) => l.email_verified === 'alive').length;
  const dead  = leads.filter((l) => l.email_verified === 'dead').length;
  const unk   = leads.filter((l) => l.email_verified === 'unknown' || !l.email_verified).length;
  console.log(`  MX results — alive:${alive}  dead:${dead}  unknown/none:${unk}`);

  // ── 8. Contact-point filter ───────────────────────────────
  leads = filterByContactPoint(leads);
  banner('4. After contact-point filter', leads);

  // ── 9. Dead-email-only filter (NEW) ───────────────────────
  const beforeDeadFilter = leads.length;
  leads = filterByDeadEmailOnly(leads);
  banner(`5. After dead-email-only filter (dropped ${beforeDeadFilter - leads.length})`, leads);

  // ── 10. Score ─────────────────────────────────────────────
  console.log('\nScoring...');
  scoreLeads(leads);

  // ── 11. Score floor filter (NEW) ──────────────────────────
  const beforeScoreFloor = leads.length;
  leads = filterByScore(leads, MIN_SCORE);
  banner(`6. After score floor ≥${MIN_SCORE} (dropped ${beforeScoreFloor - leads.length} Tier D)`, leads);

  // ── Summary ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  const tiers = { A: 0, B: 0, C: 0 };
  for (const l of leads) if (l.tier in tiers) tiers[l.tier]++;
  console.log(`FINAL: ${leads.length} quality leads  |  A:${tiers.A}  B:${tiers.B}  C:${tiers.C}`);

  const top5 = leads.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  console.log('\nTop 5:');
  for (const l of top5) {
    console.log(`  [${l.tier}] score=${l.score} | "${l.name}" | ${l.source} | email=${l.email || '—'} | mx=${l.email_verified || '—'}`);
  }
  console.log('\n✓ Test complete');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
