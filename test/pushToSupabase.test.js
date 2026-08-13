import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { syncLeadsToSupabase } from '../src/lib/pushToSupabase.js';

// syncLeadsToSupabase reaches Supabase through the supabase-js client, which
// itself goes through global fetch — stubbing fetch keeps these tests offline
// and deterministic, same convention as test/webTagger.test.js.
//
// supabase-js issues a PostgREST request per .from().upsert().select() call;
// we don't need to model its exact wire format, just distinguish "this call
// should fail" from "this call should succeed" by call count.

function stubSupabaseFetch(responder) {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (...args) => {
    call += 1;
    return responder(call, ...args);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function ok(rows = []) {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-range', `0-${rows.length}/${rows.length}`]]),
    json: async () => rows,
    text: async () => JSON.stringify(rows),
  };
}

function fail(status = 500) {
  return {
    ok: false,
    status,
    headers: new Map(),
    json: async () => ({ message: `simulated ${status}` }),
    text: async () => JSON.stringify({ message: `simulated ${status}` }),
  };
}

const lead = (n) => ({
  name: `Acme ${n}`,
  website: `https://acme${n}.com`,
  category: 'Software company',
  score: 80,
  tier: 'B',
});

function cleanupRecoveryFiles() {
  // syncLeadsToSupabase writes a timestamped file under output/ on hard
  // failure — clean up whatever the test just created so repeated runs don't
  // pile up recovery CSVs.
  try {
    for (const f of readdirSync('output')) {
      if (f.startsWith('sync-failures-')) rmSync(`output/${f}`, { force: true });
    }
  } catch {
    /* output/ may not exist locally — fine */
  }
}

test('syncLeadsToSupabase reports skipped when Supabase is not configured', async () => {
  const original = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    const result = await syncLeadsToSupabase([lead(1)]);
    assert.equal(result.skipped, true);
    assert.equal(result.synced, 0);
    assert.equal(result.failed, 0);
  } finally {
    if (original) process.env.SUPABASE_URL = original;
  }
});

test('syncLeadsToSupabase succeeds on the first attempt with no retry needed', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const restore = stubSupabaseFetch((call) => ok([{ id: 1, dedupe_key: 'acme1.com' }]));
  try {
    const result = await syncLeadsToSupabase([lead(1)]);
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.recoveryPath, null);
    assert.equal(result.idsByKey.get('acme1.com'), 1);
  } finally {
    restore();
    cleanupRecoveryFiles();
  }
});

test('syncLeadsToSupabase retries a transient failure and succeeds on the second attempt', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const restore = stubSupabaseFetch((call) =>
    call === 1 ? fail(503) : ok([{ id: 2, dedupe_key: 'acme1.com' }])
  );
  try {
    const start = Date.now();
    const result = await syncLeadsToSupabase([lead(1)]);
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 0);
    assert.ok(Date.now() - start >= 1900, 'expected the 2s backoff before the retry');
  } finally {
    restore();
    cleanupRecoveryFiles();
  }
});

test('syncLeadsToSupabase writes a recovery CSV and reports failed > 0 when every attempt fails', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const restore = stubSupabaseFetch(() => fail(500));
  try {
    const result = await syncLeadsToSupabase([lead(1), lead(2)]);
    assert.equal(result.synced, 0);
    assert.equal(result.failed, 2);
    assert.ok(result.recoveryPath, 'expected a recovery CSV path');
    assert.ok(existsSync(result.recoveryPath), 'recovery CSV should actually exist on disk');
    const content = readFileSync(result.recoveryPath, 'utf8');
    assert.ok(content.includes('Acme 1'));
    assert.ok(content.includes('Acme 2'));
  } finally {
    restore();
    cleanupRecoveryFiles();
  }
});

test('syncLeadsToSupabase never loses a lead: synced + failed always equals the input count', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const restore = stubSupabaseFetch(() => fail(500));
  try {
    const leads = Array.from({ length: 4 }, (_, i) => lead(i + 1));
    const result = await syncLeadsToSupabase(leads);
    assert.equal(result.synced + result.failed, leads.length, 'no lead should silently vanish on a hard failure');
  } finally {
    restore();
    cleanupRecoveryFiles();
  }
});
