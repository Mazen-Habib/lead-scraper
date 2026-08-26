export type Lead = {
  id: number | null;
  status: string;
  company_name: string;
  category: string;
  website: string;
  email: string;
  all_emails: string;
  // Named decision-maker, extracted free from about/team/leadership pages.
  // Optional so rows that predate this column keep typechecking.
  contact_name?: string;
  contact_title?: string;
  phone: string;
  address: string;
  linkedin: string;
  facebook: string;
  instagram: string;
  rating: string;
  review_count: string;
  company_size: string;
  hourly_rate: string;
  min_project: string;
  search_query: string;
  profile_url: string;
  source: string;
  engine: string;
  email_verified: string;
  score: string;
  tier: string;
  scraped_at: string;
  // Optional: populated once the backend has run first_seen_at/last_seen_at
  // (roadmap Phase 0) and the rules classifier (roadmap Phase 3). Optional
  // so existing rows/queries that predate these columns keep typechecking.
  first_seen_at?: string;
  last_seen_at?: string;
  industry?: string | null;
  tags?: string[];
  sub_industries?: string[];
  employee_count?: number | null;
  firm_size_band?: string | null;
  is_enterprise?: boolean;
  tag_confidence?: number | null;
  tag_source?: string | null;
  // Populated once the backend region resolver (roadmap Phase 4.2) has run.
  region?: string | null;
  country?: string | null;
  city?: string | null;
  // 'buyer' (a real business that would hire/pay for services) or 'vendor'
  // (sells the exact service category it was scraped under — the seller vs
  // buyer problem, see memory.md). null when there wasn't enough signal.
  lead_type?: string | null;
};

export const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  clutch: "Clutch.co",
  goodfirms: "GoodFirms",
  designrush: "DesignRush",
  sortlist: "Sortlist",
  github_orgs: "GitHub Orgs",
  pseb: "PSEB",
  topdevelopers: "TopDevelopers",
  eventbrite: "Eventbrite",
  openstreetmap: "OpenStreetMap",
  opencorporates: "OpenCorporates",
};
