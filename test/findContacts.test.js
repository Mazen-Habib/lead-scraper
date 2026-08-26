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
  assert.deepEqual(contacts, {
    emails: [],
    linkedin: '',
    facebook: '',
    instagram: '',
    contactName: '',
    contactTitle: '',
  });
});

// ── decision-maker extraction ───────────────────────────────────────────────

async function startSiteWith(pages) {
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

test('findContacts extracts a named decision-maker from JSON-LD Person data', async () => {
  const { server, origin } = await startSiteWith({
    '/': `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Person","name":"Jane Whitfield","jobTitle":"Founder & CEO"}
      </script>
      </head><body>Welcome</body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, 'Jane Whitfield');
    assert.equal(contacts.contactTitle, 'Founder & CEO');
  } finally {
    server.close();
  }
});

test('findContacts extracts a named decision-maker from a team-card DOM pattern', async () => {
  const { server, origin } = await startSiteWith({
    '/': `<html><body>
      <div class="team-member"><h3>John Smith</h3><p>Managing Director</p></div>
    </body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, 'John Smith');
    assert.equal(contacts.contactTitle, 'Managing Director');
  } finally {
    server.close();
  }
});

test('findContacts ignores a name+title found inside a client-testimonial quote', async () => {
  const { server, origin } = await startSiteWith({
    // Real shape seen in production: a testimonial card with the reviewer's
    // name/title right below a quoted sentence — must not be attributed to
    // the company itself as its decision-maker.
    '/': `<html><body>
      <div class="card">
        <p>“Amazing team, delivered exactly what we needed on time.”</p>
        <div><p>Jane Reviewer</p><p>Founder, Some Other Company</p></div>
      </div>
    </body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
    assert.equal(contacts.contactTitle, '');
  } finally {
    server.close();
  }
});

test('findContacts ignores name/title text that is really a nav link (e.g. "Partner Login")', async () => {
  const { server, origin } = await startSiteWith({
    // Real shape seen in production: a row of footer nav links whose text
    // happens to look like a name ("Partner Login") next to a title-shaped
    // one ("Become Partner") — neither is a person.
    '/': `<html><body>
      <div class="row">
        <div class="col"><h6><a href="/partner-login">Partner Login</a></h6></div>
        <div class="col"><h6><a href="/partner-register">Become Partner</a></h6></div>
      </div>
    </body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
    assert.equal(contacts.contactTitle, '');
  } finally {
    server.close();
  }
});

test('findContacts ignores section-heading text that matches the name shape', async () => {
  // Real false positives from a live production sample: "Meet Our Team" /
  // "Our Leadership" / "Business Immigration Advice" are 2-3 capitalized
  // words each, matching the name shape, but none is a person.
  const cases = [
    ['Meet Our Team', 'Managing Director'],
    ['Our Leadership', 'Co-Founder'],
    ['Business Immigration Advice', 'Founder Visa'],
  ];
  for (const [heading, title] of cases) {
    const { server, origin } = await startSiteWith({
      '/': `<html><body><div><h3>${heading}</h3><p>${title}</p></div></body></html>`,
      '/contact': '<html><body></body></html>',
      '/about': '<html><body></body></html>',
    });
    try {
      const contacts = await findContacts(origin);
      assert.equal(contacts.contactName, '', `"${heading}" must not be treated as a name`);
    } finally {
      server.close();
    }
  }
});

test('findContacts rejects the "John Doe" placeholder name, DOM and JSON-LD alike', async () => {
  const { server, origin } = await startSiteWith({
    '/': `<html><head>
      <script type="application/ld+json">
        {"@type":"Person","name":"John Doe","jobTitle":"CEO"}
      </script>
      </head><body><div><h3>John Doe</h3><p>CEO</p></div></body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
  } finally {
    server.close();
  }
});

test('findContacts ignores a parked/placeholder page even if it has name-shaped text', async () => {
  // Real production hit: a misconfigured site served a 200 OK "Access
  // Forbidden" template whose stock demo content ("Ava Thompson, Founder and
  // Yoga Instructor") got extracted as if it were the business's own team.
  const { server, origin } = await startSiteWith({
    '/': `<html><head><title>Access Forbidden</title>
      <meta name="description" content="Webpage description goes here" /></head>
      <body><div><h3>Ava Thompson</h3><p>Founder and Yoga Instructor</p></div></body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
  } finally {
    server.close();
  }
});

test('findContacts ignores a job-title word standing where a name should be', async () => {
  // Real production hit: "Operations Manager" / "Productions Manager" — both
  // slots are role words, not a person's name, but "Operations Manager" is
  // 2 capitalized words so it matched the name shape.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Operations Manager</h3><p>Productions Manager</p></div></body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
  } finally {
    server.close();
  }
});

test('findContacts leaves contactName empty when no person data is present', async () => {
  const { server, origin } = await startSiteWith({
    '/': '<html><body>Just a plain homepage, no team info.</body></html>',
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, '');
    assert.equal(contacts.contactTitle, '');
  } finally {
    server.close();
  }
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

test('enrichLeads skips a lead that already has an email, a linkedin, AND a contact_name', async () => {
  const { server, origin, count } = await startCountingServer();
  try {
    const leads = [
      // Already fully known — the case this test exists for: a duplicate
      // backfilled from an existing Supabase record before enrichLeads runs.
      {
        website: origin,
        email: 'known@acme.com',
        linkedin: 'https://linkedin.com/company/acme',
        contact_name: 'Jane Doe',
      },
    ];
    await enrichLeads(leads, 5);
    assert.equal(count(), 0, 'a fully-known lead must never trigger a request');
    assert.equal(leads[0].email, 'known@acme.com', 'left untouched');
    assert.equal(leads[0].linkedin, 'https://linkedin.com/company/acme', 'left untouched');
  } finally {
    server.close();
  }
});

test('enrichLeads still crawls a lead with email+linkedin but no contact_name yet', async () => {
  const { server, origin, count } = await startCountingServer();
  try {
    // The bug this guards: a source scraper (e.g. PSEB) can hand over its own
    // role-inbox email and company LinkedIn directly, satisfying the old
    // two-field skip condition before the free decision-maker crawl ever ran.
    const leads = [{ website: origin, email: 'info@acme.com', linkedin: 'https://linkedin.com/company/acme' }];
    await enrichLeads(leads, 5);
    assert.ok(count() > 0, 'a lead with no named contact yet must still be crawled');
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
