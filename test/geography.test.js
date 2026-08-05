import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRegion, resolveRegions } from '../src/quality/geography.js';

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
