import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPhoneNumbers, resolveDefaultCountryIso2, countrySlugToIso2 } from '../src/lib/phoneExtract.js';

test('extractPhoneNumbers finds an explicit international number with no hint needed', () => {
  const nums = extractPhoneNumbers('Contact: +971 4 3456 7890');
  assert.deepEqual(nums, ['+971434567890']);
});

test('extractPhoneNumbers resolves a bare Pakistani mobile number given a PK hint', () => {
  const nums = extractPhoneNumbers('Call 0300-1234567 for info', 'PK');
  assert.deepEqual(nums, ['+923001234567']);
});

test('extractPhoneNumbers resolves a bare Pakistani landline given a PK hint', () => {
  const nums = extractPhoneNumbers('Office: 021-32345678', 'PK');
  assert.deepEqual(nums, ['+922132345678']);
});

test('extractPhoneNumbers finds nothing for a bare local number with no country hint', () => {
  // Deliberate precision-over-recall: guessing the country for an ambiguous
  // local-format number risks a confidently wrong result.
  const nums = extractPhoneNumbers('Call 0300-1234567 for info');
  assert.deepEqual(nums, []);
});

test('extractPhoneNumbers rejects prices, zip codes, and dates', () => {
  const nums = extractPhoneNumbers('Price: $25,000. ZIP 90210. Founded 1998-05-12.', 'US');
  assert.deepEqual(nums, []);
});

test('extractPhoneNumbers dedupes repeated numbers', () => {
  const nums = extractPhoneNumbers('Call +971 4 3456 7890 or +971-4-3456-7890 (same number)');
  assert.deepEqual(nums, ['+971434567890']);
});

test('extractPhoneNumbers returns [] for empty/null input', () => {
  assert.deepEqual(extractPhoneNumbers(''), []);
  assert.deepEqual(extractPhoneNumbers(null), []);
});

test('resolveDefaultCountryIso2 maps a known country slug to its ISO2 code', () => {
  assert.equal(resolveDefaultCountryIso2('pakistan'), 'PK');
  assert.equal(resolveDefaultCountryIso2('uae'), 'AE');
});

test('resolveDefaultCountryIso2 passes an already-ISO2 code straight through', () => {
  assert.equal(resolveDefaultCountryIso2('PK'), 'PK');
});

test('resolveDefaultCountryIso2 returns undefined for unknown/missing input', () => {
  assert.equal(resolveDefaultCountryIso2(null), undefined);
  assert.equal(resolveDefaultCountryIso2(''), undefined);
  assert.equal(resolveDefaultCountryIso2('narnia'), undefined);
});

test('countrySlugToIso2 is the direct slug->ISO2 lookup resolveDefaultCountryIso2 wraps', () => {
  assert.equal(countrySlugToIso2('pakistan'), 'PK');
  assert.equal(countrySlugToIso2('narnia'), undefined);
});
