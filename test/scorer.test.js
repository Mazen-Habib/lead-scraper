import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead } from '../src/quality/scorer.js';

test('scoreLead gives the premium ICP bonus using real tags when classified', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const withPremiumTag = scoreLead({ ...base, tags: ['ai-ml'], tag_source: 'rules' });
  const withoutPremiumTag = scoreLead({ ...base, tags: ['web-development'], tag_source: 'rules' });
  assert.equal(withPremiumTag.score - withoutPremiumTag.score, 5);
});

test('scoreLead falls back to the keyword substring check when a lead has not been classified', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const aiByName = scoreLead({ ...base, name: 'Acme AI Solutions' });
  const plain = scoreLead({ ...base, name: 'Acme Widgets' });
  assert.equal(aiByName.score - plain.score, 5);
});

test('scoreLead gives an enterprise firmographic bonus', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const enterprise = scoreLead({ ...base, is_enterprise: true });
  const notEnterprise = scoreLead({ ...base, is_enterprise: false });
  assert.equal(enterprise.score - notEnterprise.score, 3);
});

// ── directory-source floor (see filterByScore's header in qualityFilter.js) ──

test('a businesslist_pk lead is scored on its source, not the unknown-source default', () => {
  const lead = { source: 'businesslist_pk', phone: '+92300', address: 'Lahore' };
  const unknown = { source: 'not_a_real_source', phone: '+92300', address: 'Lahore' };
  // Without the SOURCE_SCORES entry this fell to `?? 5`, costing a complete
  // directory lead 5 points purely for being from an unlisted source.
  assert.equal(scoreLead(lead).score - scoreLead(unknown).score, 5);
});

test('the score floor separates enrichable directory leads from dead-end ones', () => {
  const base = { source: 'businesslist_pk', phone: '+92300', address: 'Lahore' };
  const noWebsite = scoreLead(base).score;
  const withWebsite = scoreLead({ ...base, website: 'https://x.com' }).score;

  // The floor (config.json quality.minScore = 22) sits in this gap on purpose:
  // a lead with a website can still be upgraded by email enrichment, one
  // without it cannot. If these two scores ever converge, the floor stops
  // discriminating and the rationale in filterByScore's header is void.
  assert.ok(noWebsite < 22, `expected the no-website lead under the floor, got ${noWebsite}`);
  assert.ok(withWebsite >= 22, `expected the website lead at/above the floor, got ${withWebsite}`);
});

test('an enriched directory lead clears the original Tier C boundary on its own', () => {
  // The real fix for directory leads is email enrichment, not the floor: once
  // an email lands, the lead reaches 35 without any threshold change.
  const enriched = scoreLead({
    source: 'businesslist_pk',
    phone: '+92300',
    address: 'Lahore',
    website: 'https://x.com',
    email: 'hello@x.com',
  });
  assert.ok(enriched.score >= 35, `expected >= 35 once enriched, got ${enriched.score}`);
});
