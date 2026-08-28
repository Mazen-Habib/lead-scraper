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

test('findContacts extracts and validates a tel: link, given a country hint', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><a href="tel:+92300-1234567">Call us</a></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const contacts = await findContacts(`http://127.0.0.1:${port}`, { defaultCountryIso2: 'PK' });
    assert.equal(contacts.phone, '+923001234567');
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
    phone: '',
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

test('findContacts ignores an all-caps company/brand name standing where a name should be', async () => {
  // Real production hit: "ZEN-Y ICT SOLUTIONS" (the company's own brand name,
  // in all caps) was read as if it were a person.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>ZEN-Y ICT SOLUTIONS</h3><p>Your IT Business Technology Partner</p></div></body></html>`,
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

test('findContacts ignores a place name standing where a name should be', async () => {
  // Real production hit: "United States" / "SUF Consulting Inc. (Strategic
  // Partner)" — a location, not a person.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>United States</h3><p>Managing Partner</p></div></body></html>`,
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

test('findContacts ignores a service/product name standing where a name should be', async () => {
  // Real production hit: "Rapid MVP Development" / "CTO-as-a-Service".
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Rapid MVP Development</h3><p>CTO-as-a-Service</p></div></body></html>`,
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

test('findContacts ignores a testimonial/partner-mention title naming a different company', async () => {
  // Real production hits: "CEO, Bataib Establishment", "Owner, The Paro
  // Consulting Group", "Information Systems Director, Groupe IMA" — quoting
  // a client/partner from a DIFFERENT company, not the site's own team, with
  // no quote marks or link to otherwise flag it as untrustworthy.
  const cases = [
    'CEO, Bataib Establishment',
    'Owner, The Paro Consulting Group',
    'Information Systems Director, Groupe IMA',
  ];
  for (const title of cases) {
    const { server, origin } = await startSiteWith({
      '/': `<html><body><div><h3>Jordan Reyes</h3><p>${title}</p></div></body></html>`,
      '/contact': '<html><body></body></html>',
      '/about': '<html><body></body></html>',
    });
    try {
      const contacts = await findContacts(origin);
      assert.equal(contacts.contactName, '', `"${title}" must not be accepted as a team title`);
    } finally {
      server.close();
    }
  }
});

test('findContacts ignores a testimonial title naming a bare company with no legal suffix', async () => {
  // Real production hits: "COO/Founder, Omnidian", "Director, Rediflex AB,
  // Sweden" — the company name has no Inc/LLC/Solutions-style suffix for
  // ORG_SUFFIX_RE to catch, so the general "trailing part isn't itself a
  // role" check has to do the work instead.
  const cases = ['COO/Founder, Omnidian', 'Director, Rediflex AB, Sweden', 'SR. Project Manager, Communicate Health'];
  for (const title of cases) {
    const { server, origin } = await startSiteWith({
      '/': `<html><body><div><h3>Jordan Reyes</h3><p>${title}</p></div></body></html>`,
      '/contact': '<html><body></body></html>',
      '/about': '<html><body></body></html>',
    });
    try {
      const contacts = await findContacts(origin);
      assert.equal(contacts.contactName, '', `"${title}" must not be accepted as a team title`);
    } finally {
      server.close();
    }
  }
});

test('findContacts still accepts a multi-role title with a comma and no company name', async () => {
  // Real true positive: "Jean Marois" / "President, CEO and Co-Founder" —
  // every comma-separated part is itself a role, so this must survive the
  // testimonial-shape guard above.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Jean Marois</h3><p>President, CEO and Co-Founder</p></div></body></html>`,
    '/contact': '<html><body></body></html>',
    '/about': '<html><body></body></html>',
  });
  try {
    const contacts = await findContacts(origin);
    assert.equal(contacts.contactName, 'Jean Marois');
    assert.equal(contacts.contactTitle, 'President, CEO and Co-Founder');
  } finally {
    server.close();
  }
});

test('findContacts ignores testimonial titles using "at"/"-"/"|" instead of a comma', async () => {
  // Real production hits — same testimonial-caption problem as the comma
  // case, just with a different connector before the (different) company.
  const cases = ['VP at Bennie', 'CEO & Co-Founder - Easyfill', 'CEO | Digital Transformation'];
  for (const title of cases) {
    const { server, origin } = await startSiteWith({
      '/': `<html><body><div><h3>Jordan Reyes</h3><p>${title}</p></div></body></html>`,
      '/contact': '<html><body></body></html>',
      '/about': '<html><body></body></html>',
    });
    try {
      const contacts = await findContacts(origin);
      assert.equal(contacts.contactName, '', `"${title}" must not be accepted as a team title`);
    } finally {
      server.close();
    }
  }
});

test('findContacts ignores UI/badge text standing where a name should be', async () => {
  // Real production hits: "Admin Panel" / "Partner Panel" and "Official Odoo
  // Partner" / "AWS Partner" — dashboard chrome and certification badges, not
  // people, on agency-directory-sourced pages.
  const cases = [
    ['Admin Panel', 'Partner Panel'],
    ['Official Odoo Partner', 'AWS Partner'],
  ];
  for (const [name, title] of cases) {
    const { server, origin } = await startSiteWith({
      '/': `<html><body><div><h3>${name}</h3><p>${title}</p></div></body></html>`,
      '/contact': '<html><body></body></html>',
      '/about': '<html><body></body></html>',
    });
    try {
      const contacts = await findContacts(origin);
      assert.equal(contacts.contactName, '', `"${name}" must not be accepted as a name`);
    } finally {
      server.close();
    }
  }
});

test('findContacts ignores a domain-like company name with no separator ("CEO Raccoon.World")', async () => {
  // Real production hit: "Alex Radovichenko" / "COO Raccoon.World" — the
  // template put the company name directly after the role with no comma/at/
  // dash for hasNonTitlePart to split on.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Jordan Reyes</h3><p>COO Raccoon.World</p></div></body></html>`,
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

test('findContacts ignores a company name (with a legal suffix) standing where a name should be', async () => {
  // Real production hit: "Meridian Labs Inc." / "— Co-founder ·" — the
  // company's own name, not a person, in the name slot this time.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Meridian Labs Inc.</h3><p>Co-founder</p></div></body></html>`,
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

test('findContacts ignores a bullet-separated testimonial title ("CEO • DesignRush")', async () => {
  // Real production hit: DesignRush is one of this scraper's own directory
  // sources, not a person's employer — a badge/credit line, not a title.
  const { server, origin } = await startSiteWith({
    '/': `<html><body><div><h3>Jordan Reyes</h3><p>CEO • DesignRush</p></div></body></html>`,
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
