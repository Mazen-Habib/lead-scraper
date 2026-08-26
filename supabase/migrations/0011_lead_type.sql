-- Buyer-vs-vendor classification (memory.md's "seller vs buyer" problem):
-- directory sources (Clutch/GoodFirms/TopDevelopers/etc.) and vendor-seeking
-- search queries ("software development companies in X") produce leads that
-- SELL the service they were scraped under, not buyers of it. Resolved by
-- src/quality/leadType.js from source + search_query/category, the same
-- pattern region/country/city already use.
alter table public.leads
  add column if not exists lead_type text;

create index if not exists leads_lead_type_idx on public.leads (lead_type);
