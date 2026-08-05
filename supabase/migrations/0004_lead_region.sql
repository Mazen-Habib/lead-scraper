-- Promotes region from a client-side keyword match (address + search_query,
-- re-run in the browser on every filter change) to a real column resolved
-- once at scrape time (roadmap Phase 4.2, src/quality/geography.js).
alter table public.leads add column if not exists region text;

create index if not exists leads_region_idx on public.leads (region);
