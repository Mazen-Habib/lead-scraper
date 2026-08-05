import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameConfidence } from '../src/commands/resolveFirm.js';

test('nameConfidence gives 1.0 for an exact match after legal-suffix normalization', () => {
  assert.equal(nameConfidence('Acme Inc', 'Acme Incorporated'), 1.0);
});

test('nameConfidence gives partial credit when one name contains the other', () => {
  assert.equal(nameConfidence('Acme', 'Acme Solutions Ltd'), 0.7);
});

test('nameConfidence falls back to low confidence for unrelated names', () => {
  assert.equal(nameConfidence('Acme', 'Globex Corp'), 0.3);
});

test('nameConfidence handles missing candidate name', () => {
  assert.equal(nameConfidence('Acme', ''), 0.3);
});
