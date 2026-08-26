// Lead quality audit — answers "what is actually in our database, and how much
// of it can a customer really use?"
//
// This exists because headline counts lie. "14,808 leads" sounds like 14,808
// usable leads; it isn't. A lead is only worth something if you can (a) reach a
// real person, (b) target it by geography and industry, and (c) trust the row
// isn't corrupt. This script measures each of those separately instead of
// reporting one number that hides all three.
//
// Every check below is here because it was observed failing on real production
// data, not because it seemed like a good idea:
//   - CSV-fragment rows whose `name` is a comma-joined blob of other columns
//   - 61% of emails going to info@/contact@ reception desks, not decision makers
//   - leads with an address but no resolvable region (unfilterable in the UI)
//   - leads classified into no industry at all (invisible to every industry filter)
//
// Usage:
//   node scripts/audit-leads.js              # audit live Supabase
//   node scripts/audit-leads.js --json       # machine-readable, for CI
//   node scripts/audit-leads.js --strict     # exit 1 if critical issues found
//   node scripts/audit-leads.js --sample 5   # show N examples per issue
import 'dotenv/config';
import { fetchMasterFromSupabase } from '../src/lib/pushToSupabase.js';
import { dedupeKey } from '../src/lib/normalizeUrl.js';

// ── issue definitions ───────────────────────────────────────────────────────
//
// severity drives both the report ordering and the --strict exit code:
//   critical = the row is corrupt or unusable as a lead at all
//   high     = the lead exists but can't be acted on (no way to reach a human)
//   medium   = the lead is reachable but can't be segmented/targeted well
//   low      = cosmetic or enrichment gaps

// A name that starts with a comma or a URL, or carries Google Maps' coordinate
// blob, means a CSV row was written or parsed with shifted columns — the
// "company name" is actually a fragment of the whole row. These pollute every
// downstream filter and look absurd to a customer.
const MALFORMED_NAME = /^[,\s]|^https?:\/\/|!3m|,https?:\/\//;

// Reception desks, not people. Deliverable, but nobody's inbox in particular —
// the difference between a lead you can personalize and one you can't.
const ROLE_INBOX =
  /^(info|contact|hello|sales|admin|support|office|enquiry|enquiries|inquiry|mail|team|hi|help|general|reception|marketing|careers|jobs|hr|billing|accounts|noreply|no-reply)@/i;

// Deliberately permissive — this is a corruption check, not RFC validation.
// cleanLead.js already rejects anything unparseable upstream; what survives to
// here and still fails this is a sign something bypassed that path.
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

const CHECKS = [
  {
    id: 'malformed_name',
    severity: 'critical',
    label: 'Company name is a CSV fragment or URL (corrupt row)',
    test: (l) => MALFORMED_NAME.test(l.name || '') || (l.name || '').length > 120,
  },
  {
    id: 'no_name',
    severity: 'critical',
    label: 'No company name',
    test: (l) => !(l.name || '').trim(),
  },
  {
    id: 'invalid_email',
    severity: 'critical',
    label: 'Email present but not a plausible address',
    test: (l) => !!l.email && !PLAUSIBLE_EMAIL.test(l.email),
  },
  {
    id: 'no_contact_point',
    severity: 'high',
    label: 'No way to reach them at all (no email, phone, or LinkedIn)',
    test: (l) => !l.email && !l.phone && !l.linkedin,
  },
  {
    id: 'dead_email_only',
    severity: 'high',
    label: 'Only contact is an email confirmed dead',
    test: (l) => l.email_verified === 'dead' && !l.phone && !l.linkedin,
  },
  {
    id: 'role_inbox_only',
    severity: 'medium',
    label: 'Only reachable via a role inbox (info@/sales@ — no named person)',
    test: (l) => !!l.email && ROLE_INBOX.test(l.email),
  },
  {
    id: 'no_region',
    severity: 'medium',
    label: 'No region resolved (invisible to every region filter)',
    test: (l) => !l.region,
  },
  {
    id: 'no_industry',
    severity: 'medium',
    label: 'No industry classified (invisible to every industry filter)',
    test: (l) => !l.industry,
  },
  {
    id: 'low_confidence_tag',
    severity: 'low',
    label: 'Industry assigned with low confidence (<0.5)',
    test: (l) =>
      !!l.industry && typeof l.tag_confidence === 'number' && l.tag_confidence < 0.5,
  },
  {
    id: 'no_address',
    severity: 'low',
    label: 'No address (cannot resolve city/country granularity)',
    test: (l) => !l.address,
  },
  {
    id: 'no_website',
    severity: 'low',
    label: 'No website (blocks email enrichment and tech-stack signals)',
    test: (l) => !l.website,
  },
];

// ── reporting helpers ───────────────────────────────────────────────────────

const pct = (n, total) => (total === 0 ? '0.0' : ((100 * n) / total).toFixed(1));
const bar = (n, total, width = 24) => {
  const filled = total === 0 ? 0 : Math.round((n / total) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
};

function tally(leads, keyFn) {
  const out = {};
  for (const l of leads) {
    const k = keyFn(l) ?? '(none)';
    out[k] = (out[k] || 0) + 1;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

function daysAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ── the "actionable lead" definition ────────────────────────────────────────
//
// The single number worth reporting. A lead counts as actionable only if you
// could genuinely run a campaign against it today: it's a real row, you can
// reach a specific human, and you can segment it. Deliberately strict — the
// point of this script is to stop a big total from hiding a small usable set.
function isActionable(l) {
  if (MALFORMED_NAME.test(l.name || '') || !(l.name || '').trim()) return false;
  const reachable =
    (!!l.email && l.email_verified !== 'dead' && PLAUSIBLE_EMAIL.test(l.email)) ||
    !!l.phone ||
    !!l.linkedin;
  if (!reachable) return false;
  if (!l.region || !l.industry) return false;
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');
  const sampleArg = argv.find((a) => a.startsWith('--sample'));
  const sampleN = sampleArg
    ? Number(sampleArg.split('=')[1] ?? argv[argv.indexOf(sampleArg) + 1] ?? 3)
    : 3;

  const leads = await fetchMasterFromSupabase();
  if (leads.length === 0) {
    console.error('No leads returned — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.');
    process.exit(1);
  }
  const total = leads.length;

  // run every check once per lead
  const findings = CHECKS.map((c) => ({ ...c, hits: leads.filter(c.test) }));

  // duplicate detection is cross-row, so it doesn't fit the per-lead check shape
  const byKey = new Map();
  for (const l of leads) {
    const k = dedupeKey(l);
    if (!k) continue;
    byKey.set(k, (byKey.get(k) || 0) + 1);
  }
  const dupeKeys = [...byKey.entries()].filter(([, n]) => n > 1);
  const dupeExcess = dupeKeys.reduce((sum, [, n]) => sum + (n - 1), 0);

  const actionable = leads.filter(isActionable);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          total,
          actionable: actionable.length,
          actionable_pct: Number(pct(actionable.length, total)),
          duplicate_keys: dupeKeys.length,
          duplicate_excess_rows: dupeExcess,
          issues: findings.map((f) => ({
            id: f.id,
            severity: f.severity,
            label: f.label,
            count: f.hits.length,
            pct: Number(pct(f.hits.length, total)),
          })),
        },
        null,
        2
      )
    );
  } else {
    const line = '─'.repeat(72);
    console.log('\n' + line);
    console.log('  LEAD QUALITY AUDIT');
    console.log(line);
    console.log(`  Total rows in Supabase        ${total.toLocaleString()}`);
    console.log(
      `  Genuinely actionable          ${actionable.length.toLocaleString()}  (${pct(
        actionable.length,
        total
      )}%)  ${bar(actionable.length, total)}`
    );
    console.log(
      '  └─ real row + reachable human + has region + has industry\n'
    );

    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const group = findings.filter((f) => f.severity === sev && f.hits.length > 0);
      if (group.length === 0) continue;
      console.log(`  ${sev.toUpperCase()}`);
      for (const f of group) {
        console.log(
          `    ${String(f.hits.length).padStart(6)}  ${pct(f.hits.length, total).padStart(5)}%  ${f.label}`
        );
        for (const ex of f.hits.slice(0, sampleN)) {
          const nm = String(ex.name || '(no name)').slice(0, 44);
          console.log(`            └─ ${nm}${ex.email ? '  <' + ex.email + '>' : ''}`);
        }
      }
      console.log('');
    }

    if (dupeExcess > 0) {
      console.log('  DUPLICATES');
      console.log(
        `    ${String(dupeExcess).padStart(6)}  ${pct(dupeExcess, total).padStart(5)}%  excess rows across ${dupeKeys.length} colliding dedupe keys\n`
      );
    }

    // ── coverage: where the database is thick vs thin ────────────────────
    console.log('  COVERAGE BY REGION');
    for (const [region, n] of tally(leads, (l) => l.region)) {
      console.log(`    ${String(n).padStart(6)}  ${bar(n, total, 18)}  ${region}`);
    }
    console.log('');

    console.log('  COVERAGE BY COUNTRY (top 12)');
    for (const [country, n] of tally(leads, (l) => l.country).slice(0, 12)) {
      console.log(`    ${String(n).padStart(6)}  ${bar(n, total, 18)}  ${country}`);
    }
    console.log(`    ${String(leads.filter((l) => l.city).length).padStart(6)}  ${pct(leads.filter((l) => l.city).length, total).padStart(5)}%  have a resolved city (of ${pct(leads.filter((l) => l.country).length, total)}% with a resolved country)`);
    console.log('');

    console.log('  COVERAGE BY INDUSTRY (top 12)');
    for (const [ind, n] of tally(leads, (l) => l.industry).slice(0, 12)) {
      console.log(`    ${String(n).padStart(6)}  ${bar(n, total, 18)}  ${ind}`);
    }
    console.log('');

    console.log('  CONTACT REACHABILITY');
    const withEmail = leads.filter((l) => l.email);
    const roleInbox = withEmail.filter((l) => ROLE_INBOX.test(l.email));
    console.log(`    ${String(withEmail.length).padStart(6)}  ${pct(withEmail.length, total).padStart(5)}%  have any email`);
    console.log(`    ${String(roleInbox.length).padStart(6)}  ${pct(roleInbox.length, withEmail.length).padStart(5)}%  ...of those, role inboxes (of emails, not of total)`);
    console.log(`    ${String(leads.filter((l) => l.contact_name).length).padStart(6)}  ${pct(leads.filter((l) => l.contact_name).length, total).padStart(5)}%  have a named decision-maker (contact_name)`);
    console.log(`    ${String(leads.filter((l) => l.phone).length).padStart(6)}  ${pct(leads.filter((l) => l.phone).length, total).padStart(5)}%  have a phone`);
    console.log(`    ${String(leads.filter((l) => l.linkedin).length).padStart(6)}  ${pct(leads.filter((l) => l.linkedin).length, total).padStart(5)}%  have a LinkedIn`);
    console.log('');

    console.log('  CLASSIFICATION PROVENANCE');
    for (const [src, n] of tally(leads, (l) => l.tag_source)) {
      console.log(`    ${String(n).padStart(6)}  ${pct(n, total).padStart(5)}%  ${src}`);
    }
    console.log('');

    console.log('  FRESHNESS (by last scrape)');
    const ages = leads.map((l) => daysAgo(l.last_seen_at || l.scraped_at)).filter((d) => d !== null);
    const buckets = { '0-7d': 0, '8-30d': 0, '31-90d': 0, '90d+': 0 };
    for (const d of ages) {
      if (d <= 7) buckets['0-7d']++;
      else if (d <= 30) buckets['8-30d']++;
      else if (d <= 90) buckets['31-90d']++;
      else buckets['90d+']++;
    }
    for (const [k, n] of Object.entries(buckets)) {
      console.log(`    ${String(n).padStart(6)}  ${bar(n, total, 18)}  ${k}`);
    }
    console.log(line + '\n');
  }

  if (strict) {
    const criticalCount = findings
      .filter((f) => f.severity === 'critical')
      .reduce((sum, f) => sum + f.hits.length, 0);
    if (criticalCount > 0) {
      console.error(`FAIL (--strict): ${criticalCount} row(s) hit a critical check.`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
