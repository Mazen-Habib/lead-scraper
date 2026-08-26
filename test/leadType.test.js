import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLeadType, classifyLeadTypes } from '../src/quality/leadType.js';

test('classifyLeadType treats every directory-source lead as a vendor', () => {
  for (const source of ['clutch', 'goodfirms', 'designrush', 'sortlist', 'topdevelopers', 'pseb', 'github_orgs']) {
    assert.equal(classifyLeadType({ source, category: 'restaurant' }), 'vendor', `source=${source}`);
  }
});

test('classifyLeadType flags a vendor-seeking Google Maps query as a vendor', () => {
  const cases = [
    'software development companies in Melbourne',
    'tech startups in London',
    'digital marketing agencies in Toronto',
    'web development agencies in Dubai',
    'app development firms in Karachi',
  ];
  for (const search_query of cases) {
    assert.equal(classifyLeadType({ source: 'google_maps', search_query }), 'vendor', search_query);
  }
});

test('classifyLeadType treats a buyer-seeking Google Maps query as a buyer', () => {
  const cases = ['restaurants in Karachi', 'dentists in Dubai', 'hotels in London', 'law firms in Lahore'];
  for (const search_query of cases) {
    assert.equal(classifyLeadType({ source: 'google_maps', search_query }), 'buyer', search_query);
  }
});

test('classifyLeadType treats OpenStreetMap\'s "tech" vertical as vendor', () => {
  assert.equal(classifyLeadType({ source: 'openstreetmap', search_query: 'tech/Karachi' }), 'vendor');
});

test('classifyLeadType treats OpenStreetMap\'s "general"/"healthcare" verticals as buyer', () => {
  assert.equal(classifyLeadType({ source: 'openstreetmap', search_query: 'general/Karachi', category: 'restaurant' }), 'buyer');
  assert.equal(classifyLeadType({ source: 'openstreetmap', search_query: 'healthcare/Karachi', category: 'hospital' }), 'buyer');
});

test('classifyLeadType returns null when there is no signal at all', () => {
  assert.equal(classifyLeadType({ source: 'opencorporates' }), null);
});

test('classifyLeadTypes sets lead_type on every lead in place', () => {
  const leads = [
    { source: 'clutch', category: 'software developer' },
    { source: 'google_maps', search_query: 'restaurants in Karachi' },
    { source: 'opencorporates' },
  ];
  classifyLeadTypes(leads);
  assert.equal(leads[0].lead_type, 'vendor');
  assert.equal(leads[1].lead_type, 'buyer');
  assert.equal(leads[2].lead_type, null);
});
