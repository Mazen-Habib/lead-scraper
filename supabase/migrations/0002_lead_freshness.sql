-- Adds first_seen_at/last_seen_at so the scraper can track lead freshness
-- correctly (see src/index.js mergeMaster/pruneExpired). Backfills existing
-- rows from scraped_at/created_at so nothing is left null.
alter table public.leads add column if not exists first_seen_at timestamptz;
alter table public.leads add column if not exists last_seen_at  timestamptz;

update public.leads
set first_seen_at = coalesce(first_seen_at, scraped_at, created_at),
    last_seen_at  = coalesce(last_seen_at,  scraped_at, created_at)
where first_seen_at is null or last_seen_at is null;

create index if not exists leads_last_seen_at_idx on public.leads (last_seen_at desc);
