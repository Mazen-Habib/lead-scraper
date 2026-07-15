-- Leads table: mirrors the scraper's CSV columns (see src/index.js CSV_COLUMNS)
-- dedupe_key mirrors src/lib/normalizeUrl.js dedupeKey() so upserts collapse
-- the same company scraped from multiple sources/runs into one row.
create table if not exists public.leads (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  company_name text,
  category text,
  website text,
  email text,
  all_emails text,
  phone text,
  address text,
  linkedin text,
  facebook text,
  instagram text,
  rating numeric,
  review_count integer,
  company_size text,
  hourly_rate text,
  min_project text,
  search_query text,
  profile_url text,
  source text,
  engine text,
  email_verified text,
  score integer,
  tier text,
  scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_score_idx on public.leads (score desc);
create index if not exists leads_tier_idx on public.leads (tier);
create index if not exists leads_source_idx on public.leads (source);
create index if not exists leads_scraped_at_idx on public.leads (scraped_at desc);

-- Keep updated_at fresh on every upsert.
create or replace function public.set_leads_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_leads_updated_at();

-- RLS: dashboard reads leads publicly (anon/publishable key); only the
-- service_role key (used by the scraper) can write, and it bypasses RLS.
alter table public.leads enable row level security;

drop policy if exists "Public read access" on public.leads;
create policy "Public read access"
  on public.leads
  for select
  to anon, authenticated
  using (true);
