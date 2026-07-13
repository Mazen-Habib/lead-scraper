import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEmailDomain, verifyLeads } from '../src/quality/emailVerifier.js';

// These hit real DNS. verifyEmailDomain never throws (transient/sandboxed-
// network failures resolve to 'unknown' by design), so we assert the
// direction that matters rather than a hard-coded 'alive'/'dead' — that way
// the tests stay meaningful even in a sandbox with restricted outbound DNS.

test('verifyEmailDomain: known-good domain is never reported dead', async () => {
  const status = await verifyEmailDomain('someone@gmail.com');
  assert.notEqual(status, 'dead');
  assert.ok(['alive', 'unknown'].includes(status));
});

test('verifyEmailDomain: nonsense domain is never reported alive', async () => {
  const status = await verifyEmailDomain('someone@this-domain-should-not-exist-12345.invalid');
  assert.notEqual(status, 'alive');
  assert.ok(['dead', 'unknown'].includes(status));
});

test('verifyEmailDomain: malformed email is handled gracefully', async () => {
  assert.equal(await verifyEmailDomain('not-an-email'), 'unknown');
  assert.equal(await verifyEmailDomain(''), 'unknown');
});

test('verifyLeads sets email_verified on every lead, empty string when no email', async () => {
  const leads = [
    { name: 'A', email: 'someone@gmail.com' },
    { name: 'B' },
  ];
  await verifyLeads(leads);
  assert.ok(['alive', 'unknown'].includes(leads[0].email_verified));
  assert.equal(leads[1].email_verified, '');
});
