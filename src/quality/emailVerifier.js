import { resolveMx } from 'node:dns/promises';

// Domain -> 'alive' | 'dead' | 'unknown', shared for the life of one run so
// leads on the same company domain don't trigger duplicate DNS lookups.
const domainCache = new Map();

function extractDomain(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Checks whether an email's domain has MX records, i.e. can plausibly
 * receive mail. Transient DNS/network failures resolve to 'unknown' rather
 * than 'dead' so a flaky lookup never wrongly kills a good lead — only a
 * domain the resolver confirms has no mail capability (ENOTFOUND/ENODATA)
 * is marked 'dead'.
 */
export async function verifyEmailDomain(email) {
  const domain = extractDomain(email);
  if (!domain) return 'unknown';
  if (domainCache.has(domain)) return domainCache.get(domain);

  let status;
  try {
    const records = await resolveMx(domain);
    status = records && records.length > 0 ? 'alive' : 'dead';
  } catch (err) {
    status = err.code === 'ENOTFOUND' || err.code === 'ENODATA' ? 'dead' : 'unknown';
  }

  domainCache.set(domain, status);
  return status;
}

/** Runs verifyEmailDomain over many leads with limited concurrency. */
export async function verifyLeads(leads, concurrency = 10) {
  const queue = leads.filter((l) => l.email);
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      lead.email_verified = await verifyEmailDomain(lead.email);
      done++;
      process.stdout.write(`  Verified ${done} email domains...\r`);
    }
  }

  if (queue.length > 0) {
    await Promise.all(Array.from({ length: concurrency }, worker));
    console.log('');
  }

  for (const lead of leads) {
    if (lead.email_verified === undefined) lead.email_verified = '';
  }

  return leads;
}
