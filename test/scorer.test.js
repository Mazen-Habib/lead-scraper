import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead } from '../src/quality/scorer.js';

test('scoreLead gives the premium ICP bonus using real tags when classified', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const withPremiumTag = scoreLead({ ...base, tags: ['ai-ml'], tag_source: 'rules' });
  const withoutPremiumTag = scoreLead({ ...base, tags: ['web-development'], tag_source: 'rules' });
  assert.equal(withPremiumTag.score - withoutPremiumTag.score, 5);
});

test('scoreLead falls back to the keyword substring check when a lead has not been classified', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const aiByName = scoreLead({ ...base, name: 'Acme AI Solutions' });
  const plain = scoreLead({ ...base, name: 'Acme Widgets' });
  assert.equal(aiByName.score - plain.score, 5);
});

test('scoreLead gives an enterprise firmographic bonus', () => {
  const base = { email: 'a@b.com', email_verified: 'alive', source: 'clutch' };
  const enterprise = scoreLead({ ...base, is_enterprise: true });
  const notEnterprise = scoreLead({ ...base, is_enterprise: false });
  assert.equal(enterprise.score - notEnterprise.score, 3);
});
