-- Phase 6: personalized runtime leads. Activates the saved_searches /
-- user_leads / scrape_runs tables created (schema-only) in 0005 by adding the
-- columns the worker and dashboard need, plus the RLS policy that lets a
-- signed-in user queue a run for their own saved search.

-- How deep a personalized scrape goes, and when it last ran (drives the
-- scheduled path). `schedule` already exists from 0005 and now carries
-- 'off' | 'daily' | 'weekly'.
alter table public.saved_searches add column if not exists depth text not null default 'quick';
alter table public.saved_searches add column if not exists last_run_at timestamptz;

-- Distinguishes a lead that already existed in the corpus and is merely new to
-- this user ('backfill') from one an actual scrape run just discovered
-- ('fresh'). The dashboard badges these differently — the UI must never imply
-- cached rows are live.
alter table public.user_leads add column if not exists delivery_reason text not null default 'fresh';
alter table public.user_leads add column if not exists scrape_run_id bigint references public.scrape_runs(id) on delete set null;

create index if not exists user_leads_saved_search_idx on public.user_leads (user_id, saved_search_id);
create index if not exists user_leads_delivered_idx on public.user_leads (user_id, first_delivered_at desc);

-- The worker claims pending work with `where status = 'pending' order by created_at`.
create index if not exists scrape_runs_status_idx on public.scrape_runs (status, created_at);
create index if not exists scrape_runs_saved_search_idx on public.scrape_runs (saved_search_id, created_at desc);

-- 0005 gave scrape_runs owner SELECT only, so a user could read runs but never
-- request one. "Run now" needs INSERT. The worker itself uses the service role
-- and bypasses RLS, so it still owns all status transitions.
drop policy if exists "Owner insert access" on public.scrape_runs;
create policy "Owner insert access"
  on public.scrape_runs
  for insert
  to authenticated
  with check (auth.uid() = user_id);
