// Classifies each lead as a buyer (a real business that would hire/pay for
// services) or a vendor (a company that sells the exact service category it
// was scraped under) — the distinction memory.md calls the "seller vs buyer"
// problem: scraping "Data Analytics/BI" returns software vendors who sell
// data analytics, not companies who use it. The user's explicit ICP answer
// was "all the above" (buyers, agencies-as-customers, resale, intent-signal)
// — don't stop scraping vendor sources, just make the distinction visible
// and filterable instead of presenting every lead as if buyer-quality.
//
// Two independent signals, either one is enough to call a lead a vendor:
//   1. Source is a service-provider directory/marketplace by construction —
//      every listing on Clutch/GoodFirms/TopDevelopers/etc. IS a vendor.
//   2. The search query that found it was itself vendor-seeking ("software
//      development companies in X") rather than buyer-seeking ("restaurants
//      in X", "dentists in X").
const VENDOR_DIRECTORY_SOURCES = new Set([
  'clutch', 'goodfirms', 'designrush', 'sortlist', 'techbehemoths',
  'selectedfirms', 'topdevelopers', 'pseb', 'github_orgs',
]);

// "software development companies", "web development agencies", "tech
// startups", "digital marketing agencies", "app development firms" — a
// tech/service adjective followed (within a short span) by a
// company/agency/provider noun. Buyer-seeking queries ("restaurants in
// Karachi", "dentists in Dubai") never have this shape.
const VENDOR_QUERY_RE =
  /\b(software|it|tech|app|web(?:site)?|mobile(?: app)?|digital marketing|seo|game|ecommerce|blockchain|ai)\b[\w\s-]{0,25}\b(compan(?:y|ies)|agenc(?:y|ies)|firms?|startups?|developers?|studios?|consultanc(?:y|ies)|vendors?|providers?)\b/i;

/**
 * Returns 'vendor', 'buyer', or null (not enough signal — no search_query or
 * category to go on, e.g. a lead backfilled from an old record).
 */
export function classifyLeadType(lead) {
  if (VENDOR_DIRECTORY_SOURCES.has(lead.source)) return 'vendor';

  const query = lead.search_query || '';
  // OpenStreetMap's own "tech" vertical searches office=it/software tags —
  // literal IT/software company offices, not end-customer businesses.
  if (/^tech\//i.test(query)) return 'vendor';

  const haystack = `${query} ${lead.category || ''}`.toLowerCase();
  if (VENDOR_QUERY_RE.test(haystack)) return 'vendor';
  if (!query && !lead.category) return null;
  return 'buyer';
}

/** Sets `lead_type` on every lead in place. */
export function classifyLeadTypes(leads) {
  let vendor = 0;
  let buyer = 0;
  for (const lead of leads) {
    lead.lead_type = classifyLeadType(lead);
    if (lead.lead_type === 'vendor') vendor++;
    else if (lead.lead_type === 'buyer') buyer++;
  }
  console.log(`  Lead type: ${buyer} buyer, ${vendor} vendor, ${leads.length - buyer - vendor} unknown`);
  return leads;
}
