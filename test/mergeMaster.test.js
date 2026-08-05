import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMaster, pruneExpired } from '../src/index.js';

test('mergeMaster keeps first_seen_at but advances last_seen_at for a repeated key', () => {
  const t1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const existing = [{ website: 'acme.com', name: 'Acme', first_seen_at: t1, last_seen_at: t1, scraped_at: t1 }];

  const merged = mergeMaster(existing, [{ website: 'acme.com', name: 'Acme' }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].first_seen_at, t1);
  assert.notEqual(merged[0].last_seen_at, t1);
  assert.equal(merged[0].last_seen_at, merged[0].scraped_at);
});

test('mergeMaster sets first_seen_at === last_seen_at for a brand-new key', () => {
  const merged = mergeMaster([], [{ website: 'new-co.com', name: 'New Co' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].first_seen_at, merged[0].last_seen_at);
  assert.equal(merged[0].last_seen_at, merged[0].scraped_at);
});

test('pruneExpired drops leads whose last_seen_at is stale even if first_seen_at is much older', () => {
  const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const staleLastSeen = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const freshLastSeen = new Date().toISOString();

  const leads = [
    { website: 'stale.com', first_seen_at: veryOld, last_seen_at: staleLastSeen },
    { website: 'fresh.com', first_seen_at: veryOld, last_seen_at: freshLastSeen },
  ];

  const pruned = pruneExpired(leads, 30);

  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].website, 'fresh.com');
});
