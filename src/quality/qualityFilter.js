// Default ICP keywords used when config.qualityFilter.categoryKeywords is
// absent. Originally tech/marketing-only; broadened to general local
// business (healthcare, professional services, hospitality/retail,
// home/construction, education) so the scraper can target dentists,
// hospitals, law firms, restaurants, etc. — not just software companies.
// Genuinely irrelevant categories (cemetery, parking garage, government
// office) still correctly fail every group below.
export const DEFAULT_CATEGORY_KEYWORDS = [
  // Tech / IT / marketing (original scope)
  'software', 'technology', 'tech', 'it services', 'information technology',
  'web', 'app', 'developer', 'development', 'digital', 'systems', 'solutions',
  'computer', 'network', 'cyber', 'cloud', 'saas', 'mobile', 'data',
  'electronics', 'telecommunication',
  'marketing', 'seo', 'ppc', 'advertising', 'branding', 'media', 'content', 'growth',
  // Healthcare
  'dentist', 'dental', 'hospital', 'clinic', 'medical', 'doctor', 'physician',
  'pharmacy', 'pharmacist', 'veterinary', 'vet', 'healthcare', 'diagnostic',
  'laboratory',
  // Professional services
  'law firm', 'lawyer', 'attorney', 'legal', 'accounting', 'accountant',
  'real estate', 'realtor', 'insurance', 'consultancy', 'consulting',
  // Hospitality & retail
  'restaurant', 'cafe', 'coffee', 'hotel', 'retail', 'store', 'shop',
  'salon', 'spa', 'beauty', 'boutique',
  // Home & construction
  'contractor', 'construction', 'plumbing', 'plumber', 'electrician',
  'renovation', 'interior design',
  // Education
  'school', 'academy', 'institute', 'tutoring', 'tuition', 'training',
  // Automotive
  'automotive', 'car dealer', 'auto dealer', 'car showroom', 'auto parts',
  'spare parts', 'car rental', 'rent a car', 'motors', 'tyre',
  'tire', 'car wash', 'motorcycle',
  // Logistics & transport
  'logistics', 'freight', 'cargo', 'courier', 'shipping', 'transport',
  'trucking', 'warehousing', 'warehouse', 'movers', 'packers', 'forwarder',
  // Manufacturing & industrial
  'manufacturer', 'manufacturing', 'factory', 'mills', 'textile', 'industrial',
  'fabrication', 'machinery', 'steel', 'plastic', 'chemical', 'packaging',
  'garments', 'leather',
  // Real estate
  'property', 'estate agent', 'builders', 'developers', 'housing scheme',
  // Finance & insurance
  'bank', 'banking', 'takaful', 'investment', 'broker', 'brokerage',
  'microfinance', 'leasing', 'forex', 'audit', 'auditors', 'money exchange',
  // Agriculture & food
  'agriculture', 'agri', 'farm', 'farming', 'seeds', 'fertilizer', 'pesticide',
  'poultry', 'dairy', 'livestock', 'food processing', 'beverage',
  // Media & entertainment
  'printing', 'printers', 'photography', 'photographer', 'videography',
  'event management', 'event planner', 'production house', 'studio',
  'publishing',
  // Beauty & wellness
  'beauty parlour', 'beauty parlor', 'beautician', 'barber', 'gym', 'fitness',
  'yoga', 'wellness', 'massage', 'skin care',
];

/**
 * True if the lead's category (or name, as a fallback for sources that don't
 * provide a category) contains one of the ICP keywords.
 */
export function matchesIcp(lead, keywords = DEFAULT_CATEGORY_KEYWORDS) {
  const haystack = `${lead.category || ''} ${lead.name || ''}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

/**
 * True if the lead has at least one usable way to reach it: a phone number,
 * a LinkedIn profile, or an email that isn't confirmed dead.
 */
export function hasContactPoint(lead) {
  if (lead.phone) return true;
  if (lead.linkedin) return true;
  if (lead.email && lead.email_verified !== 'dead') return true;
  return false;
}

/**
 * Applies a predicate to a lead list, logging how many were dropped and why
 * so filtering is never silent.
 */
function applyFilter(leads, predicate, label) {
  const kept = leads.filter(predicate);
  const dropped = leads.length - kept.length;
  if (dropped > 0) console.log(`  ${dropped} leads dropped: ${label}`);
  return kept;
}

export function filterByIcp(leads, config = {}) {
  const keywords = config.qualityFilter?.categoryKeywords || DEFAULT_CATEGORY_KEYWORDS;
  return applyFilter(leads, (lead) => matchesIcp(lead, keywords), 'off-ICP category');
}

export function filterByContactPoint(leads) {
  return applyFilter(leads, hasContactPoint, 'no usable contact point (no email/phone/linkedin)');
}

/**
 * Drops leads whose only contact point is a confirmed-dead email.
 * A lead with phone or LinkedIn is kept even if its email bounces.
 */
export function filterByDeadEmailOnly(leads) {
  return applyFilter(leads, (lead) => {
    if (lead.email_verified !== 'dead') return true;
    return !!(lead.phone || lead.linkedin); // dead email is ok if there's another way in
  }, 'dead email with no fallback contact (phone/linkedin)');
}

/**
 * Drops leads below a minimum score threshold.
 * Eliminates Tier D noise before it reaches the DB or the frontend.
 */
export function filterByScore(leads, minScore = 35) {
  return applyFilter(
    leads,
    (lead) => (parseInt(lead.score) || 0) >= minScore,
    `score below ${minScore} (Tier D noise)`
  );
}
