create table if not exists public.saved_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  filter_json jsonb not null default '{}'::jsonb,
  schedule text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_user_id_idx on public.saved_searches (user_id);
alter table public.saved_searches enable row level security;
create policy "Owner full access" on public.saved_searches
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.user_leads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete cascade,
  saved_search_id bigint references public.saved_searches(id) on delete set null,
  status text not null default 'new',
  notes text,
  first_delivered_at timestamptz not null default now(),
  unique (user_id, lead_id)
);
create index if not exists user_leads_user_id_idx on public.user_leads (user_id);
create index if not exists user_leads_lead_id_idx on public.user_leads (lead_id);
alter table public.user_leads enable row level security;
create policy "Owner full access" on public.user_leads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Schema-only this phase; Phase 6's worker (service-role key) populates it.
create table if not exists public.scrape_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_search_id bigint references public.saved_searches(id) on delete cascade,
  trigger text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  leads_found integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists scrape_runs_user_id_idx on public.scrape_runs (user_id);
alter table public.scrape_runs enable row level security;
create policy "Owner read access" on public.scrape_runs
  for select to authenticated using (auth.uid() = user_id);
