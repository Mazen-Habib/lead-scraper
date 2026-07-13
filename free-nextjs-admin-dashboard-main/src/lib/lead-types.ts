export type Lead = {
  company_name: string;
  category: string;
  website: string;
  email: string;
  all_emails: string;
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
