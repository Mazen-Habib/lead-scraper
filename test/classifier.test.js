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

test('classifyLeads sets industry/tags/tag_confidence/tag_source on every lead in place', () => {
  const leads = [{ category: 'Mobile App Development', name: 'Acme' }, { category: '', name: 'Unrelated Co' }];
  classifyLeads(leads);
  assert.equal(leads[0].industry, 'mobile-apps');
  assert.equal(leads[0].tag_source, 'rules');
  assert.equal(leads[1].industry, null);
});
