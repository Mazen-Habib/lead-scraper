import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRegion, resolveRegions, resolveGeo, resolveGeos } from '../src/quality/geography.js';

test('resolveRegion matches on address', () => {
  const lead = { address: '123 Sheikh Zayed Rd, Dubai, UAE', search_query: '' };
  assert.equal(resolveRegion(lead), 'middle-east');
});

test('resolveRegion matches on search_query when address is missing', () => {
  const lead = { address: '', search_query: 'software companies in Karachi' };
  assert.equal(resolveRegion(lead), 'south-asia');
});

test('resolveRegion returns null when nothing matches', () => {
  const lead = { address: '', search_query: '' };
  assert.equal(resolveRegion(lead), null);
});

test('resolveRegion picks the region with the most keyword hits', () => {
  const lead = { address: 'Toronto, Canada', search_query: 'agency also serving Dubai clients' };
  assert.equal(resolveRegion(lead), 'north-america');
});

test('resolveRegions sets region on every lead in place', () => {
  const leads = [
    { address: 'Lahore, Pakistan', search_query: '' },
    { address: '', search_query: '' },
  ];
  resolveRegions(leads);
  assert.equal(leads[0].region, 'south-asia');
  assert.equal(leads[1].region, null);
});

// ── word-boundary fix (the "kl" bug — see memory.md) ────────────────────────

test('resolveRegion does not mistake "Brooklyn" for Kuala Lumpur ("kl")', () => {
  const lead = { address: '123 Main St, Brooklyn, NY, USA', search_query: '' };
  assert.equal(resolveRegion(lead), 'north-america');
});

test('resolveRegion does not mistake "Parkland" for Kuala Lumpur ("kl")', () => {
  const lead = { address: 'Parkland, FL, USA', search_query: '' };
  assert.equal(resolveRegion(lead), 'north-america');
});

test('resolveRegion still matches real Kuala Lumpur addresses via "kuala lumpur"', () => {
  const lead = { address: 'Kuala Lumpur, Malaysia', search_query: '' };
  assert.equal(resolveRegion(lead), 'southeast-asia');
});

// ── country/city resolution ─────────────────────────────────────────────────

test('resolveGeo resolves both country and city from a specific address', () => {
  const lead = { address: '123 Sheikh Zayed Rd, Dubai, UAE', search_query: '' };
  assert.deepEqual(resolveGeo(lead), { country: 'uae', city: 'dubai' });
});

test('resolveGeo resolves country only when no city keyword is present', () => {
  const lead = { address: 'somewhere in Kuwait', search_query: '' };
  assert.deepEqual(resolveGeo(lead), { country: 'kuwait', city: null });
});

test('resolveGeo returns nulls when nothing matches', () => {
  assert.deepEqual(resolveGeo({ address: '', search_query: '' }), { country: null, city: null });
});

test('resolveGeo does not mistake "Brooklyn" for a Malaysian city', () => {
  const lead = { address: '123 Main St, Brooklyn, NY, USA', search_query: '' };
  assert.deepEqual(resolveGeo(lead), { country: 'usa', city: null });
});

test('resolveGeos sets country and city on every lead in place', () => {
  const leads = [
    { address: 'Lahore, Pakistan', search_query: '' },
    { address: '', search_query: '' },
  ];
  resolveGeos(leads);
  assert.equal(leads[0].country, 'pakistan');
  assert.equal(leads[0].city, 'lahore');
  assert.equal(leads[1].country, null);
  assert.equal(leads[1].city, null);
});
