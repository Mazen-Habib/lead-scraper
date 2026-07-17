/**
 * Lead scorer — produces a 0–100 score and an A/B/C/D tier for every lead.
 *
 * Four pillars (weighted):
 *   Reachability  35 pts  — can we actually contact them?
 *   Credibility   35 pts  — are they a real, established business?
 *   Source        20 pts  — how reliable is the data origin?
 *   Profile        10 pts  — how complete is the firmographic data?
 */

const SOURCE_SCORES = {
  clutch:       20,
  goodfirms:    18,
  topdevelopers: 14,
  designrush:   12,
  sortlist:     12,
  google_maps:  10,
  github_orgs:   8,
  pseb:          8,
  eventbrite:    5,
  openstreetmap: 6,
  opencorporates: 6,
};

// High-value ICP keywords that indicate a premium tech company
const PREMIUM_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'fintech', 'saas',
  'blockchain', 'cloud', 'cybersecurity', 'data', 'devops', 'iot',
  'automation', 'erp', 'enterprise',
];

export function scoreLead(lead) {
  let score = 0;

  // ── Reachability (max 35) ────────────────────────────────────────────────
  if (lead.email) {
    if      (lead.email_verified === 'alive') score += 22; // MX-confirmed — highest confidence
    else if (lead.email_verified !== 'dead')  score += 12; // unverified — plausible
    // dead MX: 0 pts — treat as no email for scoring purposes
  }
  if (lead.phone)    score += 8;
  if (lead.linkedin) score += 7;
  if (lead.website)  score += 3;
  // multiple emails = more entry points
  if (lead.all_emails && lead.all_emails.includes(';')) score += 2;

  // ── Credibility (max 35) ────────────────────────────────────────────────
  const rating  = parseFloat(lead.rating)  || 0;
  const reviews = parseInt(lead.reviews)   || 0;

  if      (rating >= 4.7) score += 15;
  else if (rating >= 4.5) score += 12;
  else if (rating >= 4.0) score +=  8;
  else if (rating >= 3.5) score +=  4;
  else if (rating  >  0)  score +=  1;

  if      (reviews >= 200) score += 15;
  else if (reviews >= 100) score += 12;
  else if (reviews >=  50) score +=  8;
  else if (reviews >=  20) score +=  5;
  else if (reviews >=   5) score +=  2;

  if (lead.company_size) score += 3;
  if (lead.hourly_rate)  score += 2;

  // ── Source quality (max 20) ──────────────────────────────────────────────
  score += SOURCE_SCORES[lead.source] ?? 5;

  // ── Profile completeness (max 10) ────────────────────────────────────────
  if (lead.address)     score += 2;
  if (lead.min_project) score += 2;
  if (lead.facebook || lead.instagram) score += 1;

  // Premium ICP bonus (+5 uncapped bonus on top)
  const haystack = `${lead.category || ''} ${lead.name || ''}`.toLowerCase();
  if (PREMIUM_KEYWORDS.some((kw) => haystack.includes(kw))) score += 5;

  score = Math.min(100, score);

  // ── Tier ─────────────────────────────────────────────────────────────────
  let tier;
  if      (score >= 75) tier = 'A';   // top tier — reach out immediately
  else if (score >= 55) tier = 'B';   // strong — worth pursuing
  else if (score >= 35) tier = 'C';   // qualified — nurture / enrich further
  else                  tier = 'D';   // weak — low data, low confidence

  return { score, tier };
}

export function scoreLeads(leads) {
  let counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const lead of leads) {
    const { score, tier } = scoreLead(lead);
    lead.score = score;
    lead.tier  = tier;
    counts[tier]++;
  }
  console.log(`  Scored ${leads.length} leads — A:${counts.A}  B:${counts.B}  C:${counts.C}  D:${counts.D}`);
  return leads;
}
