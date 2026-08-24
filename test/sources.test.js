import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherLeads } from '../src/sources/index.js';

// ── gatherLeads({ only }) validation ─────────────────────────────────────────
//
// Added after weekly-scrape.yml's --only list was hand-written directly
// against SOURCE_REGISTRY's keys, and the filter that reads `only` used to
// have no validation at all: a typo just silently matched nothing for that
// source, with no warning anywhere. Only the rejection path is tested here —
// not synchronously, before any source's buildJobs() or network call runs —
// so this stays fast and deterministic in CI rather than exercising real
// scrapers.

test('gatherLeads rejects an --only key that matches no SOURCE_REGISTRY entry', async () => {
  await assert.rejects(
    () => gatherLeads({}, {}, { only: ['googleMaps', 'notARealSourceKey'] }),
    /unknown source key.*notARealSourceKey/
  );
});

test('gatherLeads rejects entirely before touching any source when only unknown keys are given', async () => {
  // A config of {} would make most sources' buildJobs() throw or no-op, so if
  // validation ran AFTER the loop started this test would still likely pass —
  // asserting the specific error message (not just "it rejected") is what
  // actually proves the check fires up front.
  await assert.rejects(
    () => gatherLeads({}, {}, { only: ['definitelyNotReal'] }),
    (err) => err.message.startsWith('--only referenced unknown source key(s): definitelyNotReal')
  );
});
