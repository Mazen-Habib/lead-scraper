// Post-scrape filtering + attribution helpers for personalized runs.
//
// Split out from runSavedSearches.js so the decision logic — "does this lead
// actually satisfy what the user asked for?" — is pure and unit-testable
// without a database or a browser.
import { dedupeKey } from '../lib/normalizeUrl.js';

/**
 * Applies the parts of a saved search's filter that targeting can't express as
 * scrape parameters.
 *
 * A directory lets you ask for "web developers in the UAE"; it has no idea
 * about our lead score, tier, or whether we found an email. Those dimensions
 * therefore have to be enforced here, after the pipeline has scored the leads —
 * otherwise a user who saved "Tier A, has email" would be delivered whatever
 * the scrape happened to return, which is precisely the kind of quiet mismatch
 * that makes personalized leads feel fake.
 */
export function matchesSavedFilter(lead, filter = {}) {
  if (filter.tier && lead.tier !== filter.tier) return false;
  if (filter.source && lead.source !== filter.source) return false;
  if (filter.industry && lead.industry !== filter.industry) return false;
  if (filter.region && lead.region !== filter.region) return false;
  if (filter.firmSizeBand && lead.firm_size_band !== filter.firmSizeBand) return false;
  if (filter.tag && !(lead.tags || []).includes(filter.tag)) return false;

  const score = parseInt(lead.score, 10) || 0;
  if (filter.minScore != null && score < filter.minScore) return false;
  if (filter.maxScore != null && score > filter.maxScore) return false;

  if (filter.hasEmail && !lead.email) return false;

  if (filter.search) {
    const needle = String(filter.search).trim().toLowerCase();
    if (needle) {
      const hay = [lead.company_name, lead.name, lead.email, lead.address, lead.category, lead.search_query]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
  }
  return true;
}

/**
 * Builds the user_leads rows for one saved search from a run's scraped leads.
 *
 * `idsByKey` comes from syncLeadsToSupabase — a lead with no id was never
 * persisted (bad dedupe key, or its upsert batch failed), so it is skipped
 * rather than attributed to a row that doesn't exist.
 */
export function buildUserLeadRows(leads, { userId, savedSearchId, scrapeRunId, filter, idsByKey }) {
  const rows = [];
  const seen = new Set();
  for (const lead of leads) {
    if (!matchesSavedFilter(lead, filter)) continue;
    const key = dedupeKey(lead);
    if (!key) continue;
    const leadId = idsByKey.get(key);
    if (leadId == null) continue;
    if (seen.has(leadId)) continue; // same company twice in one run
    seen.add(leadId);
    rows.push({
      user_id: userId,
      lead_id: leadId,
      saved_search_id: savedSearchId,
      scrape_run_id: scrapeRunId,
      delivery_reason: 'fresh',
    });
  }
  return rows;
}
