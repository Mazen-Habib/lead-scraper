import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findContacts, enrichLeads } from '../src/scrapers/emailFinder.js';

// Spins up a tiny local site so findContacts can be exercised without any
// live network dependency: '/' links to a footer '/team' page (only found via
// deep-mode footer discovery), which is the only page with a mailto: link.
async function startTestSite() {
  const pages = {
    '/': `<html><body>
      <p>Welcome to Acme</p>
      <footer><a href="/our-team">Meet the team</a></footer>
    </body></html>`,
    '/our-team': `<html><body>
      <a href="mailto:hello@acme-test.com">Email us</a>
      <a href="https://linkedin.com/company/acme-test">LinkedIn</a>
    </body></html>`,
  };
  const server = createServer((req, res) => {
    const body = pages[req.url];
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

test('findContacts in shallow (default) mode does not discover footer-only pages', async () => {
  const { server, origin } = await startTestSite();
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.emails.length, 0);
    assert.equal(contacts.linkedin, '');
  } finally {
    server.close();
  }
});

test('findContacts in deep mode follows footer links to find contacts CANDIDATE_PATHS misses', async () => {
  const { server, origin } = await startTestSite();
  try {
    const contacts = await findContacts(origin, { deep: true });
    assert.deepEqual(contacts.emails, ['hello@acme-test.com']);
    assert.equal(contacts.linkedin, 'https://linkedin.com/company/acme-test');
  } finally {
    server.close();
  }
});

test('findContacts returns empty result for an unparsable website', async () => {
  const contacts = await findContacts('not a url');
  assert.deepEqual(contacts, { emails: [], linkedin: '', facebook: '', instagram: '' });
});

// ── enrichLeads batch-level skip ────────────────────────────────────────────

async function startCountingServer() {
  let requestCount = 0;
  const server = createServer((_req, res) => {
    requestCount++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>plain page, no contacts here</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}`, count: () => requestCount };
}

test('enrichLeads skips a lead that already has both an email and a linkedin', async () => {
  const { server, origin, count } = await startCountingServer();
  try {
    const leads = [
      // Already fully known — the case this test exists for: a duplicate
      // backfilled from an existing Supabase record before enrichLeads runs.
      { website: origin, email: 'known@acme.com', linkedin: 'https://linkedin.com/company/acme' },
    ];
    await enrichLeads(leads, 5);
    assert.equal(count(), 0, 'a fully-known lead must never trigger a request');
    assert.equal(leads[0].email, 'known@acme.com', 'left untouched');
    assert.equal(leads[0].linkedin, 'https://linkedin.com/company/acme', 'left untouched');
  } finally {
    server.close();
  }
});

test('enrichLeads still crawls a lead that has an email but no linkedin', async () => {
  const { server, origin, count } = await startCountingServer();
  try {
    const leads = [{ website: origin, email: 'partial@acme.com', linkedin: '' }];
    await enrichLeads(leads, 5);
    assert.ok(count() > 0, 'a partially-known lead (email but no linkedin) must still be crawled');
  } finally {
    server.close();
  }
});

test('enrichLeads skips a lead with no website regardless of email/linkedin state', async () => {
  const leads = [{ website: '', email: '', linkedin: '' }];
  await enrichLeads(leads, 5); // must resolve without attempting any fetch
  assert.deepEqual(leads[0], { website: '', email: '', linkedin: '' });
});
