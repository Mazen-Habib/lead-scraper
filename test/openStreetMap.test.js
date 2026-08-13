import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuery,
  scrapeOpenStreetMap,
  TECH_TAG_FILTERS,
  HEALTHCARE_TAG_FILTERS,
  GENERAL_BUSINESS_TAG_FILTERS,
} from '../src/scrapers/openStreetMap.js';

// ── filter sets ──────────────────────────────────────────────────────────────

test('HEALTHCARE_TAG_FILTERS covers dentists, hospitals, clinics, doctors, pharmacies, vets', () => {
  const joined = HEALTHCARE_TAG_FILTERS.join(' ');
  for (const tag of ['dentist', 'hospital', 'clinic', 'doctors', 'pharmacy', 'veterinary']) {
    assert.ok(joined.includes(tag), `expected an amenity="${tag}" filter`);
  }
});

test('GENERAL_BUSINESS_TAG_FILTERS covers professional services and hospitality', () => {
  const joined = GENERAL_BUSINESS_TAG_FILTERS.join(' ');
  for (const tag of ['lawyer', 'estate_agent', 'restaurant', 'hotel']) {
    assert.ok(joined.includes(tag), `expected a filter for "${tag}"`);
  }
});

test('the three filter sets are disjoint (no accidental overlap between verticals)', () => {
  const all = [...TECH_TAG_FILTERS, ...HEALTHCARE_TAG_FILTERS, ...GENERAL_BUSINESS_TAG_FILTERS];
  assert.equal(new Set(all).size, all.length);
});

// ── buildQuery ───────────────────────────────────────────────────────────────

test('buildQuery embeds the city as an area and every filter as an nwr clause', () => {
  const q = buildQuery('Karachi', ['["amenity"="dentist"]', '["amenity"="hospital"]']);
  assert.match(q, /area\["name"="Karachi"\]->\.a;/);
  assert.match(q, /nwr\["amenity"="dentist"\]\(area\.a\);/);
  assert.match(q, /nwr\["amenity"="hospital"\]\(area\.a\);/);
});

// ── scrapeOpenStreetMap (network stubbed) ───────────────────────────────────

function stubOverpass(elements) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ elements }),
  });
  return () => {
    globalThis.fetch = original;
  };
}

test('scrapeOpenStreetMap maps the amenity tag to category for healthcare/general leads', async () => {
  const restore = stubOverpass([
    { type: 'node', id: 1, tags: { name: 'Bright Smile Dental', amenity: 'dentist', phone: '123' } },
    { type: 'node', id: 2, tags: { name: 'City General Hospital', amenity: 'hospital' } },
    { type: 'node', id: 3, tags: { name: 'Grand Hotel', tourism: 'hotel' } },
  ]);
  try {
    const leads = await scrapeOpenStreetMap('Karachi', HEALTHCARE_TAG_FILTERS);
    assert.equal(leads.length, 3);
    assert.equal(leads.find((l) => l.name === 'Bright Smile Dental').category, 'dentist');
    assert.equal(leads.find((l) => l.name === 'City General Hospital').category, 'hospital');
    assert.equal(leads.find((l) => l.name === 'Grand Hotel').category, 'hotel');
  } finally {
    restore();
  }
});

test('scrapeOpenStreetMap still maps office/shop/craft tags for the tech vertical', async () => {
  const restore = stubOverpass([
    { type: 'node', id: 1, tags: { name: 'Acme Software', office: 'software' } },
  ]);
  try {
    const leads = await scrapeOpenStreetMap('Karachi', TECH_TAG_FILTERS);
    assert.equal(leads[0].category, 'software');
  } finally {
    restore();
  }
});

test('scrapeOpenStreetMap skips elements with no name and de-dupes by website/name', async () => {
  const restore = stubOverpass([
    { type: 'node', id: 1, tags: { amenity: 'dentist' } }, // no name — skipped
    { type: 'node', id: 2, tags: { name: 'Acme Dental', amenity: 'dentist', website: 'https://acme-dental.com' } },
    { type: 'node', id: 3, tags: { name: 'Acme Dental Branch', amenity: 'dentist', website: 'https://acme-dental.com' } },
  ]);
  try {
    const leads = await scrapeOpenStreetMap('Karachi', HEALTHCARE_TAG_FILTERS);
    assert.equal(leads.length, 1);
  } finally {
    restore();
  }
});
