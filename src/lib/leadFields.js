// Canonical internal-field <-> CSV/DB column mapping. Shared by the CSV
// writer (src/index.js), the pipeline's dedupe() (src/pipeline/runPipeline.js),
// and the master merge (mergeMaster in src/index.js) so there's one list to
// extend when a new lead field is added, not three.
export const CSV_COLUMNS = [
  ['name', 'company_name'],
  ['category', 'category'],
  ['website', 'website'],
  ['email', 'email'],
  ['all_emails', 'all_emails'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['linkedin', 'linkedin'],
  ['facebook', 'facebook'],
  ['instagram', 'instagram'],
  ['rating', 'rating'],
  ['reviews', 'review_count'],
  ['company_size', 'company_size'],
  ['hourly_rate', 'hourly_rate'],
  ['min_project', 'min_project'],
  ['search_query', 'search_query'],
  ['maps_url', 'profile_url'],
  ['source', 'source'], // which data source: google_maps, openstreetmap, clutch, goodfirms
  ['engine', 'engine'], // which tool fetched it: normal_scraper or cloak_browser
  ['email_verified', 'email_verified'],
  ['score', 'score'],   // 0-100 composite quality score
  ['tier', 'tier'],     // A / B / C / D — A is top tier
  ['scraped_at', 'scraped_at'],       // last time this lead was confirmed present
  ['first_seen_at', 'first_seen_at'], // first time this lead was ever discovered
  ['last_seen_at', 'last_seen_at'],   // same value as scraped_at, kept explicit for clarity
  ['industry', 'industry'],                 // primary taxonomy bucket, e.g. 'ai-ml'
  ['tags', 'tags'],                         // every matched taxonomy bucket, semicolon-joined in CSV
  ['sub_industries', 'sub_industries'],     // tags minus the primary industry, semicolon-joined
  ['employee_count', 'employee_count'],     // parsed from company_size
  ['firm_size_band', 'firm_size_band'],     // solo / small / mid / large / enterprise
  ['is_enterprise', 'is_enterprise'],
  ['tag_confidence', 'tag_confidence'],     // 0-1, confidence of the classifier pass
  ['tag_source', 'tag_source'],             // 'rules' / 'llm' / 'manual'
];
