import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLead, classifyLeads } from '../src/quality/classifier.js';

test('classifyLead picks AI/ML as the primary industry for an AI-flavored lead', () => {
  const result = classifyLead({ category: 'Artificial Intelligence Company', name: 'Acme AI', website: 'acme-ai.com' });
  assert.equal(result.industry, 'ai-ml');
  assert.ok(result.tags.includes('ai-ml'));
  assert.ok(result.confidence > 0);
  assert.equal(result.tag_source, 'rules');
});

test('classifyLead pulls signal from the profile_url slug when category is unhelpful', () => {
  const result = classifyLead({
    category: 'Company',
    name: 'Acme',
    maps_url: 'https://clutch.co/profile/acme-web-development-agency',
  });
  assert.equal(result.industry, 'web-development');
});

test('classifyLead returns zero confidence and null industry when nothing matches', () => {
  const result = classifyLead({ category: '', name: 'XYZ Holdings', website: 'xyz123.io' });
  assert.equal(result.industry, null);
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.tags, []);
});

test('classifyLead ranks the industry with more keyword hits first when multiple match', () => {
  // "seo" + "ppc" + "digital marketing" (3 hits) should outrank "web" (1 hit)
  const result = classifyLead({ category: 'Web / SEO / PPC / Digital Marketing agency' });
  assert.equal(result.industry, 'digital-marketing');
  assert.ok(result.tags.includes('web-development'));
});

test('classifyLead classifies the new general-local-business verticals', () => {
  assert.equal(classifyLead({ category: 'Dental Clinic', name: 'Bright Smile Dental' }).industry, 'healthcare');
  assert.equal(classifyLead({ category: 'General Hospital' }).industry, 'healthcare');
  assert.equal(classifyLead({ category: 'Law Firm', name: 'Acme Legal Services' }).industry, 'professional-services');
  assert.equal(classifyLead({ category: 'Restaurant', name: 'Cafe Delight' }).industry, 'hospitality-retail');
  assert.equal(classifyLead({ category: 'Construction Contractor' }).industry, 'home-construction');
  assert.equal(classifyLead({ category: 'Private School', name: 'Bright Future Academy' }).industry, 'education-training');
});

test('classifyLead ignores a Google Maps URL data blob instead of treating it as a slug', () => {
  // Regression: the last path segment of a Maps URL is "data=!4m7!3m6!1s0x...",
  // whose literal "data" substring used to falsely match data-analytics-bi and
  // outrank the correct "healthcare" bucket on tied keyword count.
  const result = classifyLead({
    category: 'Hospital',
    name: 'General Hospital',
    maps_url:
      'https://www.google.com/maps/place/General+Hospital/data=!4m7!3m6!1s0x391904!8m2!3d31.5!4d74.3',
  });
  assert.equal(result.industry, 'healthcare');
  assert.ok(!result.tags.includes('data-analytics-bi'));
});

test('classifyLeads sets industry/tags/tag_confidence/tag_source on every lead in place', () => {
  const leads = [{ category: 'Mobile App Development', name: 'Acme' }, { category: '', name: 'Unrelated Co' }];
  classifyLeads(leads);
  assert.equal(leads[0].industry, 'mobile-apps');
  assert.equal(leads[0].tag_source, 'rules');
  assert.equal(leads[1].industry, null);
});

// ── substring false positives (measured on a real businesslist.pk crawl) ─────

test('short taxonomy keywords do not match inside ordinary company names', () => {
  // classifyLead used to run matchTaxonomy in substring mode, which mis-tagged
  // 22 of 130 leads on a real crawl. Each of these is a genuine scraped name.
  const cases = [
    ['HairSense', 'beauty professionals', 'ai-ml'],          // h·ai·rsense
    ['Asad Enterprises', 'car rental', 'erp-sap'],            // ent·erp·rises
    ['Bigbasket.pk', 'beauty professionals', 'data-analytics-bi'], // ·bi·gbasket
    ['Ismail Estate', 'estate agents', 'ai-ml'],              // ism·ai·l
  ];
  for (const [name, category, wrongSlug] of cases) {
    const { industry, tags } = classifyLead({ name, category });
    assert.notEqual(industry, wrongSlug, `"${name}" must not be tagged ${wrongSlug}`);
    assert.ok(!tags.includes(wrongSlug), `"${name}" must not carry the ${wrongSlug} tag`);
  }
});

test('a plural in the text still matches a singular keyword', () => {
  // The taxonomy says "estate agent"; businesslist.pk's category is "estate
  // agents". Requiring an exact boundary match dropped those, trading false
  // positives for false negatives — plurality must not decide classification.
  for (const category of ['estate agent', 'estate agents']) {
    const { industry } = classifyLead({ name: 'Acme', category });
    assert.equal(industry, 'real-estate', `"${category}" should classify as real-estate`);
  }
});

test('an already-plural keyword never has its "s" stripped, so acronyms stay intact', () => {
  // Tolerating plurals in both directions turns "ios" into "io", which then
  // matches any .io domain — the exact regression this asserts against.
  const { industry, tags } = classifyLead({ name: 'XYZ Holdings', website: 'xyz123.io' });
  assert.equal(industry, null, 'a bare .io domain must not read as an iOS shop');
  assert.deepEqual(tags, []);
});

test('real directory categories classify into the vertical they describe', () => {
  const expectations = [
    ['auto repair', 'automotive'],
    ['car rental', 'automotive'],
    ['estate agents', 'real-estate'],
    ['beauty professionals', 'beauty-wellness'],
  ];
  for (const [category, slug] of expectations) {
    assert.equal(classifyLead({ name: 'Acme', category }).industry, slug, category);
  }
});
