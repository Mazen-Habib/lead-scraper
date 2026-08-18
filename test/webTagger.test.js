import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTaxonomy } from '../src/quality/classifier.js';
import { tagLeadsFromWeb } from '../src/quality/webTagger.js';
import { createPacer, readAsText } from '../src/lib/jinaReader.js';

// ── matchTaxonomy ───────────────────────────────────────────────────────────

test('matchTaxonomy in substring mode keeps the original classifier behaviour', () => {
  const hits = matchTaxonomy('artificial intelligence company acme ai');
  assert.equal(hits[0].slug, 'ai-ml');
});

test('matchTaxonomy in word-boundary mode ignores keywords buried inside longer words', () => {
  // "bi" (data-analytics-bi) must not match inside "ambient"/"ambitious",
  // and "etl" must not match inside "kettle" — the exact false positives that
  // make substring matching unusable over full page prose.
  const hits = matchTaxonomy('an ambient and ambitious kettle', { wordBoundary: true });
  assert.deepEqual(hits, []);
});

test('matchTaxonomy in word-boundary mode still matches standalone short keywords', () => {
  const hits = matchTaxonomy('we build etl pipelines and bi dashboards', { wordBoundary: true });
  assert.equal(hits[0].slug, 'data-analytics-bi');
  assert.ok(hits[0].matchCount >= 2);
});

test('matchTaxonomy ranks the bucket with more keyword hits first', () => {
  const hits = matchTaxonomy('seo ppc digital marketing and a little web work');
  assert.equal(hits[0].slug, 'digital-marketing');
});

// ── tagLeadsFromWeb ─────────────────────────────────────────────────────────
//
// The network call lives in jinaReader.readAsText, which is reached through
// global fetch — stubbing fetch keeps these tests offline and deterministic.

function stubFetch(bodyByUrl) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const match = Object.entries(bodyByUrl).find(([key]) => String(url).includes(key));
    if (!match) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => match[1] };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('tagLeadsFromWeb recovers an industry from homepage prose', async () => {
  const restore = stubFetch({
    'acme.com':
      'Acme builds custom mobile apps. Our ios and android engineers ship react native ' +
      'and flutter apps for startups. Mobile app development is all we do.',
  });
  try {
    const leads = [{ company_name: 'Acme', website: 'https://acme.com', industry: null }];
    await tagLeadsFromWeb(leads, { concurrency: 1, requestsPerMinute: 0 });
    assert.equal(leads[0].industry, 'mobile-apps');
    assert.equal(leads[0].tag_source, 'web');
    assert.ok(leads[0].tag_confidence > 0);
    assert.ok(leads[0].tags.includes('mobile-apps'));
  } finally {
    restore();
  }
});

test('tagLeadsFromWeb never overwrites a lead the rules pass already classified', async () => {
  const restore = stubFetch({
    'acme.com': 'we do seo ppc digital marketing advertising branding content growth',
  });
  try {
    const leads = [
      {
        company_name: 'Acme',
        website: 'https://acme.com',
        industry: 'ai-ml',
        tags: ['ai-ml'],
        tag_source: 'rules',
        tag_confidence: 0.9,
      },
    ];
    await tagLeadsFromWeb(leads, { concurrency: 1, requestsPerMinute: 0 });
    assert.equal(leads[0].industry, 'ai-ml');
    assert.equal(leads[0].tag_source, 'rules');
    assert.equal(leads[0].tag_confidence, 0.9);
  } finally {
    restore();
  }
});

test('tagLeadsFromWeb leaves a lead untagged when evidence is below minKeywordHits', async () => {
  const restore = stubFetch({
    // A single incidental "cloud" must not be enough to label the company.
    'vague.com': 'We are a family business founded in 1994. Ask us about our cloud.',
  });
  try {
    const leads = [{ company_name: 'Vague Co', website: 'https://vague.com', industry: null }];
    await tagLeadsFromWeb(leads, { concurrency: 1, requestsPerMinute: 0, minKeywordHits: 2 });
    assert.equal(leads[0].industry, null);
    assert.equal(leads[0].tag_source, undefined);
  } finally {
    restore();
  }
});

test('tagLeadsFromWeb survives an unreachable website without throwing', async () => {
  const restore = stubFetch({});
  try {
    const leads = [{ company_name: 'Dead Co', website: 'https://dead.example', industry: null }];
    await tagLeadsFromWeb(leads, { concurrency: 1, requestsPerMinute: 0 });
    assert.equal(leads[0].industry, null);
  } finally {
    restore();
  }
});

test('tagLeadsFromWeb respects maxLeads so a free endpoint is never flooded', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => 'we do etl and bi dashboards and data warehouse work' };
  };
  try {
    const leads = Array.from({ length: 10 }, (_, i) => ({
      company_name: `Co ${i}`,
      website: `https://co${i}.com`,
      industry: null,
    }));
    await tagLeadsFromWeb(leads, { concurrency: 2, requestsPerMinute: 0, maxLeads: 3 });
    assert.equal(calls, 3);
    assert.equal(leads.filter((l) => l.industry).length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

// ── rate limiting ───────────────────────────────────────────────────────────

test('createPacer spaces calls at least minIntervalMs apart across concurrent callers', async () => {
  const pace = createPacer(50);
  const stamps = [];
  await Promise.all(
    Array.from({ length: 4 }, () => (async () => {
      await pace();
      stamps.push(Date.now());
    })())
  );
  stamps.sort((a, b) => a - b);
  // 4 calls at 50ms spacing spans >= 150ms; allow slack for timer coarseness.
  assert.ok(stamps[3] - stamps[0] >= 140, `expected >=140ms span, got ${stamps[3] - stamps[0]}`);
});

test('createPacer(0) disables pacing entirely', async () => {
  const pace = createPacer(0);
  const start = Date.now();
  await pace();
  await pace();
  assert.ok(Date.now() - start < 20);
});

test('readAsText retries once after a 429 and returns the retried body', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, text: async () => 'rate limited' };
    return { ok: true, status: 200, text: async () => 'x'.repeat(200) };
  };
  try {
    const text = await readAsText('https://acme.com', { rateLimitBackoffMs: 10 });
    assert.equal(calls, 2);
    assert.equal(text.length, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test('readAsText gives up after a second 429 rather than looping', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 429, text: async () => 'rate limited' };
  };
  try {
    const text = await readAsText('https://acme.com', { rateLimitBackoffMs: 10 });
    assert.equal(calls, 2);
    assert.equal(text, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('readAsText treats a near-empty page as no signal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => 'tiny' });
  try {
    assert.equal(await readAsText('https://acme.com'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('tagLeadsFromWeb skips leads that have no website at all', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 404, text: async () => '' };
  };
  try {
    const leads = [{ company_name: 'No Site Co', website: '', industry: null }];
    await tagLeadsFromWeb(leads, { concurrency: 1, requestsPerMinute: 0 });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
