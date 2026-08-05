// Phase 2.1 — "tell me about this one company": crawl a single website and
// run it through the same quality pipeline the weekly scrape uses.
import { findContacts } from '../scrapers/emailFinder.js';
import { runPipeline } from '../pipeline/runPipeline.js';
import { normalizeUrl } from '../lib/normalizeUrl.js';

function siteName(website) {
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    return host.split('.')[0];
  } catch {
    return website;
  }
}

/**
 * Scrapes a single company website for contact info, then scores it through
 * runPipeline like any other lead.
 *
 * opts: { config, pythonBin } — same options runPipeline() accepts.
 * Returns the single enriched lead object, or null if it was filtered out
 * (e.g. no usable contact point, or below the score floor).
 */
export async function scrapeUrl(website, opts = {}) {
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  if (!normalizeUrl(url)) throw new Error(`Not a usable URL: ${website}`);

  console.log(`Crawling ${url} (deep mode)...`);
  const contacts = await findContacts(url, { deep: true });

  const rawLead = {
    name: siteName(url),
    category: '',
    website: url,
    email: contacts.emails[0] || '',
    all_emails: contacts.emails.join('; '),
    phone: '',
    address: '',
    linkedin: contacts.linkedin,
    facebook: contacts.facebook,
    instagram: contacts.instagram,
    rating: '',
    reviews: '',
    company_size: '',
    hourly_rate: '',
    min_project: '',
    search_query: `url:${website}`,
    maps_url: '',
    source: 'on_demand_url',
    engine: 'on_demand',
    scraped_at: new Date().toISOString(),
  };

  const [scored] = await runPipeline([rawLead], { ...opts, findEmails: false });
  return scored || null;
}
