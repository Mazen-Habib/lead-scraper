import { resolveMx } from 'node:dns/promises';
import { probeMailbox } from './smtpVerifier.js';

// Domain -> { status, hosts }, shared for the life of one run so leads on
// the same company domain don't trigger duplicate DNS lookups.
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
 * is marked 'dead'. Also returns the resolved MX hosts, sorted by priority,
 * so a mailbox-level probe (see verifyEmailMailbox below) doesn't need a
 * second DNS round-trip.
 */
export async function verifyEmailDomain(email) {
  const domain = extractDomain(email);
  if (!domain) return { status: 'unknown', hosts: [] };
  if (domainCache.has(domain)) return domainCache.get(domain);

  let result;
  try {
    const records = await resolveMx(domain);
    const hosts = (records || []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    result = { status: hosts.length > 0 ? 'alive' : 'dead', hosts };
  } catch (err) {
    const status = err.code === 'ENOTFOUND' || err.code === 'ENODATA' ? 'dead' : 'unknown';
    result = { status, hosts: [] };
  }

  domainCache.set(domain, result);
  return result;
}

/**
 * Mailbox-level verification, one tier stricter than the MX-only check: if
 * the domain has MX records, probe the real mailbox via smtpVerifier.js's
 * RCPT TO handshake. Never downgrades a domain-level 'alive' to 'unknown',
 * and never runs at all on a domain already confirmed 'dead' — there's
 * nothing a mailbox probe could add once the whole domain can't take mail.
 *
 * Needs outbound SMTP (port 25) to actually reach a verdict; a network that
 * blocks it (common on cloud/sandboxed hosts) makes this a no-op that
 * returns the domain-level status unchanged — see smtpVerifier.js's
 * docstring for why that's a deliberate fail-safe, not a bug.
 */
export async function verifyEmailMailbox(email) {
  const domainResult = await verifyEmailDomain(email);
  if (domainResult.status !== 'alive' || domainResult.hosts.length === 0) return domainResult.status;

  const probe = await probeMailbox(email, domainResult.hosts[0]);
  return probe === 'unknown' ? domainResult.status : probe;
}

/**
 * Runs verification over many leads with limited concurrency.
 * smtpVerify: false (default) does the fast MX-only check already proven in
 * production; true additionally probes each mailbox over SMTP, which is
 * slower (one TCP round-trip per lead) and only adds signal on networks
 * that allow outbound port 25.
 */
export async function verifyLeads(leads, concurrency = 10, { smtpVerify = false } = {}) {
  const queue = leads.filter((l) => l.email);
  const verify = smtpVerify ? verifyEmailMailbox : (email) => verifyEmailDomain(email).then((r) => r.status);
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const lead = queue.shift();
      lead.email_verified = await verify(lead.email);
      done++;
      process.stdout.write(`  Verified ${done} email ${smtpVerify ? 'mailboxes' : 'domains'}...\r`);
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
