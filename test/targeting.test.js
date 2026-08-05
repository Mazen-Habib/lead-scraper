import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScrapeConfig,
  describeCoverage,
  scrapeSignature,
  QUICK_SOURCES,
  DEEP_SOURCES,
} from '../src/personalized/targeting.js';
import { matchesSavedFilter, buildUserLeadRows } from '../src/personalized/attribution.js';
import { isScheduleDue, groupBySignature } from '../src/personalized/runSavedSearches.js';

// ── buildScrapeConfig ───────────────────────────────────────────────────────

test('buildScrapeConfig turns a filter into real, well-formed source targets', () => {
  const { config, only, coverage } = buildScrapeConfig(
    { industry: 'ai-ml', region: 'middle-east' },
    { depth: 'quick' }
  );

  // Google Maps free-text uses the industry's search term and the region's cities
  assert.ok(config.googleMaps.searches.includes('AI companies in Dubai'));
  // Clutch speaks `country/service`
  assert.ok(config.clutch.directories.includes('ae/developers'));
  // GoodFirms speaks a country-name path
  assert.ok(config.goodFirms.directories.includes('directory/country/top-software-development-companies/united-arab-emirates'));

  assert.deepEqual(only, QUICK_SOURCES);
  assert.ok(coverage.jobCount > 0);
});

test('buildScrapeConfig depth widens the source set and page depth', () => {
  const quick = buildScrapeConfig({ industry: 'web-development', region: 'south-asia' }, { depth: 'quick' });
  const deep = buildScrapeConfig({ industry: 'web-development', region: 'south-asia' }, { depth: 'deep' });

  assert.deepEqual(quick.only, QUICK_SOURCES);
  assert.deepEqual(deep.only, DEEP_SOURCES);
  assert.equal(quick.config.clutch.maxPages, 1);
  assert.equal(deep.config.clutch.maxPages, 2);
  assert.ok(deep.coverage.jobCount > quick.coverage.jobCount);
});

test('buildScrapeConfig uses each source own vocabulary for the same industry', () => {
  const { config } = buildScrapeConfig({ industry: 'mobile-apps', region: 'middle-east' }, { depth: 'deep' });
  assert.ok(config.clutch.directories.every((d) => d.endsWith('/mobile-app-developers')));
  assert.ok(config.designRush.queries.every((q) => q.category === 'mobile-app-development'));
  assert.ok(config.techBehemoths.queries.every((q) => q.service === 'mobile-app-development'));
  // DesignRush uses ISO-2, TechBehemoths uses a full country slug — not interchangeable
  assert.ok(config.designRush.queries.some((q) => q.country === 'AE'));
  assert.ok(config.techBehemoths.queries.some((q) => q.country === 'united-arab-emirates'));
});

test('buildScrapeConfig reports a coverage gap instead of scraping the wrong category', () => {
  // GoodFirms/TechBehemoths/SelectedFirms have no marketing directory.
  const { only, coverage } = buildScrapeConfig(
    { industry: 'digital-marketing', region: 'africa' },
    { depth: 'deep' }
  );
  assert.ok(!only.includes('goodFirms'));
  const skippedSources = coverage.skipped.map((s) => s.source);
  assert.ok(skippedSources.includes('goodFirms'));
  assert.match(describeCoverage(coverage), /Skipped: /);
  // ...but the run is still real: Google Maps and Clutch do cover it.
  assert.ok(coverage.jobCount > 0);
});

test('buildScrapeConfig still produces jobs when no industry or region is set', () => {
  const { coverage } = buildScrapeConfig({}, { depth: 'quick' });
  assert.ok(coverage.jobCount > 0, 'an unfiltered saved search must still scrape something real');
});

test('buildScrapeConfig yields zero jobs and an explicit message for an unknown region', () => {
  const { only, coverage } = buildScrapeConfig({ industry: 'ai-ml', region: 'atlantis' }, { depth: 'deep' });
  assert.equal(coverage.jobCount, 0);
  assert.deepEqual(only, []);
  assert.match(describeCoverage(coverage), /No source covers/);
});

test('scrapeSignature collapses identical searches and separates different ones', () => {
  const a = scrapeSignature({ industry: 'ai-ml', region: 'middle-east', minScore: 50 }, 'quick');
  const b = scrapeSignature({ industry: 'ai-ml', region: 'middle-east', minScore: 90 }, 'quick');
  const c = scrapeSignature({ industry: 'ai-ml', region: 'europe' }, 'quick');
  const d = scrapeSignature({ industry: 'ai-ml', region: 'middle-east' }, 'deep');
  assert.equal(a, b, 'minScore is applied after scraping, so it must not split the scrape');
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

// ── matchesSavedFilter (post-scrape filtering) ──────────────────────────────

const lead = (over = {}) => ({
  company_name: 'Acme',
  tier: 'A',
  score: '80',
  email: 'a@acme.com',
  industry: 'ai-ml',
  region: 'middle-east',
  tags: ['ai-ml'],
  website: 'https://acme.com',
  ...over,
});

test('matchesSavedFilter enforces filters the directories cannot express', () => {
  assert.ok(matchesSavedFilter(lead(), { tier: 'A', minScore: 50, hasEmail: true }));
  assert.ok(!matchesSavedFilter(lead({ tier: 'C' }), { tier: 'A' }));
  assert.ok(!matchesSavedFilter(lead({ score: '20' }), { minScore: 50 }));
  assert.ok(!matchesSavedFilter(lead({ score: '95' }), { maxScore: 90 }));
  assert.ok(!matchesSavedFilter(lead({ email: '' }), { hasEmail: true }));
  assert.ok(!matchesSavedFilter(lead(), { tag: 'blockchain' }));
  assert.ok(!matchesSavedFilter(lead(), { search: 'zzz-no-match' }));
  assert.ok(matchesSavedFilter(lead(), { search: 'acme' }));
});

// ── buildUserLeadRows (attribution) ─────────────────────────────────────────

test('buildUserLeadRows attributes only matching, persisted leads', () => {
  const leads = [
    lead({ company_name: 'Good', website: 'https://good.com' }),
    lead({ company_name: 'LowScore', website: 'https://low.com', score: '10' }),
    lead({ company_name: 'NotPersisted', website: 'https://ghost.com' }),
  ];
  const idsByKey = new Map();
  // Only the first two ever reached the DB; the third has no id.
  idsByKey.set('good.com', 11);
  idsByKey.set('low.com', 22);

  const rows = buildUserLeadRows(leads, {
    userId: 'u1',
    savedSearchId: 5,
    scrapeRunId: 9,
    filter: { minScore: 50 },
    idsByKey,
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    user_id: 'u1',
    lead_id: 11,
    saved_search_id: 5,
    scrape_run_id: 9,
    delivery_reason: 'fresh',
  });
});

test('buildUserLeadRows does not attribute the same lead twice within a run', () => {
  const leads = [
    lead({ company_name: 'Acme', website: 'https://acme.com' }),
    lead({ company_name: 'Acme Duplicate', website: 'https://acme.com' }),
  ];
  const idsByKey = new Map([['acme.com', 7]]);
  const rows = buildUserLeadRows(leads, {
    userId: 'u1',
    savedSearchId: 1,
    scrapeRunId: 1,
    filter: {},
    idsByKey,
  });
  assert.equal(rows.length, 1);
});

test('buildUserLeadRows marks everything it delivers as freshly scraped', () => {
  const idsByKey = new Map([['acme.com', 7]]);
  const rows = buildUserLeadRows([lead()], {
    userId: 'u1',
    savedSearchId: 1,
    scrapeRunId: 3,
    filter: {},
    idsByKey,
  });
  assert.equal(rows[0].delivery_reason, 'fresh');
});

// ── grouping (cost scales with distinct searches, not users) ────────────────

const entry = (runId, userId, filter, depth = 'quick') => ({
  run: { id: runId },
  search: { id: runId, user_id: userId, name: `s${runId}`, filter_json: filter, depth },
});

test('groupBySignature collapses two users wanting the same thing into one scrape', () => {
  const groups = groupBySignature([
    entry(1, 'alice', { industry: 'ai-ml', region: 'middle-east', tier: 'A' }),
    entry(2, 'bob', { industry: 'ai-ml', region: 'middle-east', minScore: 80 }),
  ]);
  assert.equal(groups.length, 1, 'one scrape should serve both users');
  assert.equal(groups[0].entries.length, 2, 'both users still get attributed separately');
});

test('groupBySignature keeps genuinely different scrapes apart', () => {
  const groups = groupBySignature([
    entry(1, 'alice', { industry: 'ai-ml', region: 'middle-east' }),
    entry(2, 'bob', { industry: 'ai-ml', region: 'europe' }),
    entry(3, 'carol', { industry: 'ai-ml', region: 'middle-east' }, 'deep'),
  ]);
  assert.equal(groups.length, 3);
});

// ── schedule ────────────────────────────────────────────────────────────────

test('isScheduleDue respects cadence, activity, and last run', () => {
  const now = Date.parse('2026-08-05T12:00:00Z');
  const dayAgo = '2026-08-04T11:00:00Z';
  const hourAgo = '2026-08-05T11:00:00Z';

  assert.ok(isScheduleDue({ schedule: 'daily', is_active: true, last_run_at: dayAgo }, now));
  assert.ok(!isScheduleDue({ schedule: 'daily', is_active: true, last_run_at: hourAgo }, now));
  assert.ok(isScheduleDue({ schedule: 'daily', is_active: true, last_run_at: null }, now));
  assert.ok(!isScheduleDue({ schedule: 'daily', is_active: false, last_run_at: null }, now));
  assert.ok(!isScheduleDue({ schedule: 'off', is_active: true, last_run_at: null }, now));
  assert.ok(!isScheduleDue({ schedule: null, is_active: true, last_run_at: null }, now));
  assert.ok(!isScheduleDue({ schedule: 'weekly', is_active: true, last_run_at: dayAgo }, now));
});
