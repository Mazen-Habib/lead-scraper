import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeYouTube } from '../src/scrapers/youtube.js';

test('scrapeYouTube returns [] and warns when no API key is set (no network call made)', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not be called'); };
  try {
    const leads = await scrapeYouTube('marketing agency Lahore', { apiKey: '' });
    assert.deepEqual(leads, []);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('scrapeYouTube extracts a business website and skips platform/aggregator links', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/search')) {
      return {
        ok: true,
        json: async () => ({ items: [{ snippet: { channelId: 'UC123' } }] }),
      };
    }
    if (u.includes('/channels')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'UC123',
              snippet: {
                title: 'Acme Digital Marketing',
                country: 'PK',
                description:
                  'Follow us on https://instagram.com/acmedigital and https://linktr.ee/acme — book us at https://acmedigital.pk or email hello@acmedigital.pk',
              },
            },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const leads = await scrapeYouTube('marketing agency Lahore', { apiKey: 'test-key' });
    assert.equal(leads.length, 1);
    assert.equal(leads[0].website, 'https://acmedigital.pk');
    assert.equal(leads[0].email, 'hello@acmedigital.pk');
    assert.equal(leads[0].name, 'Acme Digital Marketing');
  } finally {
    global.fetch = originalFetch;
  }
});

test('scrapeYouTube skips a channel with no usable website or email', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/search')) {
      return { ok: true, json: async () => ({ items: [{ snippet: { channelId: 'UC456' } }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        items: [{ id: 'UC456', snippet: { title: 'Random Vlogs', description: 'Just vlogging my life!' } }],
      }),
    };
  };
  try {
    const leads = await scrapeYouTube('marketing agency Lahore', { apiKey: 'test-key' });
    assert.deepEqual(leads, []);
  } finally {
    global.fetch = originalFetch;
  }
});
