import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesIcp,
  hasContactPoint,
  filterByIcp,
  filterByContactPoint,
} from '../src/quality/qualityFilter.js';

test('matchesIcp accepts a tech category', () => {
  assert.equal(matchesIcp({ category: 'Software company' }), true);
  assert.equal(matchesIcp({ category: 'web development agency' }), true);
});

test('matchesIcp falls back to name when category is off-ICP or missing', () => {
  assert.equal(matchesIcp({ category: '', name: 'Acme Software Solutions' }), true);
  assert.equal(matchesIcp({ category: 'Restaurant', name: 'Joe\'s Pizza' }), false);
});

test('hasContactPoint requires phone, linkedin, or a non-dead email', () => {
  assert.equal(hasContactPoint({ phone: '123' }), true);
  assert.equal(hasContactPoint({ linkedin: 'https://linkedin.com/company/acme' }), true);
  assert.equal(hasContactPoint({ email: 'a@acme.com', email_verified: 'alive' }), true);
  assert.equal(hasContactPoint({ email: 'a@acme.com', email_verified: 'unknown' }), true);
  assert.equal(hasContactPoint({ email: 'a@acme.com', email_verified: 'dead' }), false);
  assert.equal(hasContactPoint({}), false);
});

test('filterByIcp drops off-ICP leads and logs nothing crashes', () => {
  const leads = [
    { category: 'Software company', name: 'A' },
    { category: 'Bakery', name: 'B' },
  ];
  const kept = filterByIcp(leads, {});
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, 'A');
});

test('filterByContactPoint drops leads with no usable contact info', () => {
  const leads = [
    { name: 'A', phone: '123' },
    { name: 'B' },
  ];
  const kept = filterByContactPoint(leads);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, 'A');
});
