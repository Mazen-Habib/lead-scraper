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

// Taxonomy buckets (src/quality/classifier.js) that indicate a premium tech
// company — used as the ICP bonus once a lead has been classified. Falls
// back to a plain substring check on category/name for leads that haven't
// been through classifyLeads() yet (e.g. older cached data, or callers using
// scoreLead() directly outside runPipeline).
const PREMIUM_INDUSTRIES = new Set([
  'ai-ml', 'cloud-devops', 'cybersecurity', 'erp-sap', 'blockchain', 'data-analytics-bi',
]);
const PREMIUM_KEYWORDS_FALLBACK = [
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

  // Premium ICP bonus (+5 uncapped bonus on top). Prefers real classifier
  // tags when available; falls back to the old substring hack otherwise.
  const hasTags = Array.isArray(lead.tags) && lead.tag_source;
  const isPremium = hasTags
    ? lead.tags.some((t) => PREMIUM_INDUSTRIES.has(t))
    : PREMIUM_KEYWORDS_FALLBACK.some((kw) =>
        `${lead.category || ''} ${lead.name || ''}`.toLowerCase().includes(kw)
      );
  if (isPremium) score += 5;

  // Enterprise firmographic bonus (+3 uncapped) — a 1,000+ employee firm is
  // a categorically different lead than a 5-person shop with the same tags.
  if (lead.is_enterprise) score += 3;

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
