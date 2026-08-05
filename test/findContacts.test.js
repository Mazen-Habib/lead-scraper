import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findContacts } from '../src/scrapers/emailFinder.js';

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
