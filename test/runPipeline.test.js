import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, backfillFromKnown } from '../src/pipeline/runPipeline.js';
import { dedupeKey } from '../src/lib/normalizeUrl.js';

// ── dedupe ───────────────────────────────────────────────────────────────

test('dedupe merges two scrapes of the same company, filling gaps not overwriting', () => {
  const leads = [
    { name: 'Acme Corp', website: 'https://acme.com', email: '', rating: '4.8' },
    { name: 'Acme Corp', website: 'https://acme.com', email: 'hi@acme.com', rating: '' },
  ];
  const merged = dedupe(leads);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].email, 'hi@acme.com');
  assert.equal(merged[0].rating, '4.8');
});

test('dedupe keeps the first value when both duplicates have one', () => {
  const leads = [
    { name: 'Acme Corp', website: 'https://acme.com', email: 'first@acme.com' },
    { name: 'Acme Corp', website: 'https://acme.com', email: 'second@acme.com' },
  ];
  const merged = dedupe(leads);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].email, 'first@acme.com');
});

// ── backfillFromKnown ────────────────────────────────────────────────────
//
// This is what makes enrichLeads/scrapegraph's own "already have an email"
// skip checks fire correctly for a re-scraped duplicate — those checks read
// the lead object, not Supabase, so a freshly-scraped duplicate with no email
// on the raw scrape needs the known email injected before enrichment runs.

test('backfillFromKnown fills empty fields on a matching lead from the known record', () => {
  const known = { name: 'Acme Corp', website: 'https://acme.com', email: 'hi@acme.com', linkedin: 'https://linkedin.com/company/acme' };
  const knownByKey = new Map([[dedupeKey(known), known]]);

  const leads = [{ name: 'Acme Corp', website: 'https://acme.com', email: '', linkedin: '' }];
  backfillFromKnown(leads, knownByKey);

  assert.equal(leads[0].email, 'hi@acme.com');
  assert.equal(leads[0].linkedin, 'https://linkedin.com/company/acme');
});

test('backfillFromKnown never overwrites a field the fresh scrape already populated', () => {
  const known = { name: 'Acme Corp', website: 'https://acme.com', email: 'old@acme.com' };
  const knownByKey = new Map([[dedupeKey(known), known]]);

  // This scrape found a different (presumably newer/better) email itself.
  const leads = [{ name: 'Acme Corp', website: 'https://acme.com', email: 'new@acme.com' }];
  backfillFromKnown(leads, knownByKey);

  assert.equal(leads[0].email, 'new@acme.com', 'fresh scrape data must win over stale known data');
});

test('backfillFromKnown leaves a genuinely new lead untouched', () => {
  const known = { name: 'Acme Corp', website: 'https://acme.com', email: 'hi@acme.com' };
  const knownByKey = new Map([[dedupeKey(known), known]]);

  const leads = [{ name: 'Totally New Co', website: 'https://newco.com', email: '' }];
  backfillFromKnown(leads, knownByKey);

  assert.equal(leads[0].email, '', 'a lead with no matching known record must not be touched');
});

test('backfillFromKnown is a safe no-op when knownByKey is omitted or empty', () => {
  const leads = [{ name: 'Acme Corp', website: 'https://acme.com', email: '' }];
  assert.doesNotThrow(() => backfillFromKnown(leads, null));
  assert.doesNotThrow(() => backfillFromKnown(leads, undefined));
  assert.doesNotThrow(() => backfillFromKnown(leads, new Map()));
  assert.equal(leads[0].email, '', 'no known map means nothing changes');
});

test('backfillFromKnown lets a duplicate legitimately survive the contact-point filter downstream', () => {
  // The correctness case this function exists to guarantee: a duplicate whose
  // RAW scrape has zero contact info (common for a bare Google Maps re-hit)
  // must still end up with a contact point once backfilled, so it is not
  // wrongly dropped by filterByContactPoint before ever reaching mergeMaster.
  const known = { name: 'Acme Corp', website: 'https://acme.com', email: 'hi@acme.com', phone: '' };
  const knownByKey = new Map([[dedupeKey(known), known]]);

  const rawRescrape = { name: 'Acme Corp', website: 'https://acme.com', email: '', phone: '' };
  backfillFromKnown([rawRescrape], knownByKey);

  const hasContactPoint = !!(rawRescrape.email || rawRescrape.phone || rawRescrape.linkedin);
  assert.ok(hasContactPoint, 'backfilled lead must have a usable contact point');
});
