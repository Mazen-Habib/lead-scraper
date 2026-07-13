import * as cheerio from 'cheerio';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
// Paths most likely to expose a contact email
const CANDIDATE_PATHS = ['', '/contact', '/about'];
// Junk matches that regex picks up from asset filenames / trackers
const JUNK_PATTERNS =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.(com|org)|@2x|@3x|^(xxx|email|name|user|your|test|firstname|lastname)@|@(xxx|domain|yourdomain|yoursite|sentry|example)\.|placeholder/i;

async function fetchPage(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw new Error(`Not HTML: ${type}`);
  return res.text();
}

/**
 * Crawls a company website's homepage + common contact pages.
 * Returns { emails: [...], linkedin: '', facebook: '', instagram: '' }
 */
export async function findContacts(website) {
  const contacts = { emails: new Set(), linkedin: '', facebook: '', instagram: '' };
  let origin;
  try {
    origin = new URL(website).origin;
  } catch {
    return { emails: [], linkedin: '', facebook: '', instagram: '' };
  }

  for (const path of CANDIDATE_PATHS) {
    // Stop early once we have an email and a LinkedIn link
    if (contacts.emails.size > 0 && contacts.linkedin) break;

    let html;
    try {
      html = await fetchPage(origin + path);
    } catch {
      continue;
    }

    const $ = cheerio.load(html);

    // mailto: links are the most reliable signal
    $('a[href^="mailto:"]').each((_, el) => {
      const email = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (email && !JUNK_PATTERNS.test(email)) contacts.emails.add(email);
    });

    // Fall back to regex over visible text + raw HTML
    const matches = html.match(EMAIL_RE) || [];
    for (const m of matches) {
      const email = m.toLowerCase();
      if (!JUNK_PATTERNS.test(email)) contacts.emails.add(email);
    }

    // Social profiles (LinkedIn is the valuable one for B2B scoring)
    if (!contacts.linkedin) {
      const li = $('a[href*="linkedin.com/"]').first().attr('href');
      if (li) contacts.linkedin = li.split('?')[0];
    }
    if (!contacts.facebook) {
      const fb = $('a[href*="facebook.com/"]').first().attr('href');
      if (fb) contacts.facebook = fb.split('?')[0];
    }
    if (!contacts.instagram) {
      const ig = $('a[href*="instagram.com/"]').first().attr('href');
      if (ig) contacts.instagram = ig.split('?')[0];
    }
  }

  return {
    emails: [...contacts.emails].slice(0, 3),
    linkedin: contacts.linkedin,
    facebook: contacts.facebook,
    instagram: contacts.instagram,
  };
}

/** Runs findContacts over many leads with limited concurrency. */
export async function enrichLeads(leads, concurrency = 15) {
  const queue = leads.filter((l) => l.website);
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      try {
        const c = await findContacts(lead.website);
        // Merge crawler results with scraper-provided values — prefer the
        // crawler's contact page email (more reliable) but never blank-out
        // a field that the original scraper already populated.
        const prevEmail = lead.email || '';
        lead.email = c.emails[0] || prevEmail;
        const emailSet = new Set([...c.emails, ...(prevEmail ? [prevEmail] : [])]);
        lead.all_emails = [...emailSet].filter(Boolean).join('; ');
        lead.linkedin = c.linkedin || lead.linkedin || '';
        lead.facebook = c.facebook || lead.facebook || '';
        lead.instagram = c.instagram || lead.instagram || '';
      } catch {
        /* leave fields as-is on error */
      }
      done++;
      process.stdout.write(`  Enriched ${done} websites...\r`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log('');
  return leads;
}
