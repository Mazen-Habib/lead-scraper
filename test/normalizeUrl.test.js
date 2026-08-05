import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, dedupeKey, normalizeName } from '../src/lib/normalizeUrl.js';

test('normalizeUrl collapses protocol/www/trailing-slash/case/path variants to the same domain', () => {
  const variants = [
    'http://acme.com',
    'https://acme.com',
    'https://www.acme.com/',
    'HTTPS://WWW.ACME.COM',
    'acme.com/',
    'https://www.acme.com/en',
    'https://acme.com/about-us',
    'https://acme.com/contact?ref=footer',
  ];
  const keys = new Set(variants.map(normalizeUrl));
  assert.equal(keys.size, 1, `expected 1 unique key, got ${keys.size}: ${[...keys].join(', ')}`);
  assert.equal([...keys][0], 'acme.com');
});

test('normalizeUrl returns empty string for falsy input', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
  assert.equal(normalizeUrl(undefined), '');
});

test('dedupeKey prefers website, falls back to legal-suffix-normalized name', () => {
  assert.equal(dedupeKey({ website: 'https://acme.com/', name: 'Acme Inc' }), 'acme.com');
  assert.equal(dedupeKey({ website: '', name: 'Acme Inc' }), 'acme');
});

test('normalizeName strips legal-entity suffixes and punctuation so name variants collapse', () => {
  assert.equal(normalizeName('Acme Corp.'), normalizeName('Acme Corporation'));
  assert.equal(normalizeName('Acme, LLC'), 'acme');
  assert.equal(normalizeName('Acme Pvt Ltd'), 'acme');
  assert.equal(normalizeName(''), '');
});
