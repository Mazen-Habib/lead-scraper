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
  assert.equal(matchesIcp({ category: 'Parking Garage', name: 'Downtown Parking' }), false);
});

// The ICP was broadened from tech-only to general local business (healthcare,
// professional services, hospitality/retail, home/construction, education) —
// these confirm the new verticals are accepted while genuine junk still isn't.
test('matchesIcp accepts the new general-local-business verticals', () => {
  assert.equal(matchesIcp({ category: 'Dental Clinic' }), true);
  assert.equal(matchesIcp({ category: 'General Hospital' }), true);
  assert.equal(matchesIcp({ category: 'Law Firm' }), true);
  assert.equal(matchesIcp({ category: 'Restaurant' }), true);
  assert.equal(matchesIcp({ category: 'Construction Contractor' }), true);
  assert.equal(matchesIcp({ category: 'Private School' }), true);
});

test('matchesIcp accepts the vertical expansion beyond local services', () => {
  assert.equal(matchesIcp({ category: 'Car Showroom' }), true);
  assert.equal(matchesIcp({ category: 'Freight & Cargo Services' }), true);
  assert.equal(matchesIcp({ category: 'Textile Manufacturer' }), true);
  assert.equal(matchesIcp({ category: 'Property Dealers' }), true);
  assert.equal(matchesIcp({ category: 'Insurance Broker' }), true);
  assert.equal(matchesIcp({ category: 'Poultry Farm' }), true);
  assert.equal(matchesIcp({ category: 'Printing Press', name: 'Al-Noor Printers' }), true);
  assert.equal(matchesIcp({ category: 'Beauty Parlour' }), true);
});

test('matchesIcp still rejects genuinely irrelevant categories', () => {
  assert.equal(matchesIcp({ category: 'Cemetery' }), false);
  assert.equal(matchesIcp({ category: 'Government Office' }), false);
  // 'garage' is deliberately NOT an ICP keyword — it would admit parking
  // garages. Automotive leads come in via showroom/dealer/motors instead.
  assert.equal(matchesIcp({ category: 'Parking Garage' }), false);
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
