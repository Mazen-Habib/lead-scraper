// Every fallback rung added on top of the existing pipeline (Firecrawl,
// curl-impersonate, MarkItDown, Crawlee) must be a safe no-op when its
// prerequisite (API key / binary / python) isn't available — never throw,
// never mutate leads. This is the contract that lets them be additive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichWithFirecrawl } from '../src/lib/firecrawlEnricher.js';
import { curlFetchText } from '../src/lib/curlImpersonate.js';
import { readViaMarkItDown } from '../src/lib/markitdownReader.js';

test('enrichWithFirecrawl no-ops when FIRECRAWL_API_KEY is unset', async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    const leads = [{ website: 'https://example.com', email: '' }];
    const result = await enrichWithFirecrawl(leads);
    assert.equal(result[0].email, '');
    assert.equal(result, leads); // same array reference, untouched
  } finally {
    if (originalKey !== undefined) process.env.FIRECRAWL_API_KEY = originalKey;
  }
});

test('enrichWithFirecrawl no-ops when there are no leads missing email', async () => {
  process.env.FIRECRAWL_API_KEY = 'fake-key-for-test';
  try {
    const leads = [{ website: 'https://example.com', email: 'already@has-one.com' }];
    const result = await enrichWithFirecrawl(leads);
    assert.equal(result[0].email, 'already@has-one.com');
  } finally {
    delete process.env.FIRECRAWL_API_KEY;
  }
});

test('curlFetchText returns null (not throw) when the binary is unavailable', () => {
  const result = curlFetchText('https://example.com', { timeoutMs: 2000 });
  assert.equal(result, null);
});

test('readViaMarkItDown returns null (not throw) when pythonBin is not given', () => {
  const result = readViaMarkItDown('https://example.com', {});
  assert.equal(result, null);
});

test('readViaMarkItDown returns null for an empty url', () => {
  const result = readViaMarkItDown('', { pythonBin: 'python3' });
  assert.equal(result, null);
});
