-- Lead lifecycle status + soft-delete. Lets signed-in dashboard users track
-- outreach state (new/contacted/qualified/converted/rejected) and retire
-- stale leads from view without physically deleting rows the weekly scraper
-- might legitimately re-upsert (it only writes scrape-derived columns via
-- toRow(), never status/deleted_at, so a user's lifecycle state survives
-- future syncs).
alter table public.leads add column if not exists status text not null default 'new';
alter table public.leads add column if not exists deleted_at timestamptz;

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_deleted_at_idx on public.leads (deleted_at) where deleted_at is not null;

-- Public/authenticated reads now exclude soft-deleted rows. service_role
-- (the scraper) bypasses RLS entirely, so upserts are unaffected either way.
drop policy if exists "Public read access" on public.leads;
create policy "Public read access"
  on public.leads
  for select
  to anon, authenticated
  using (deleted_at is null);

-- Signed-in users may update lifecycle fields only — contact info, score,
-- tags etc. stay scraper-only (service_role). Column-level GRANT enforces
-- this since RLS alone is row-level, not column-level.
revoke update on public.leads from authenticated;
grant update (status, deleted_at) on public.leads to authenticated;

drop policy if exists "Authenticated lifecycle update" on public.leads;
create policy "Authenticated lifecycle update"
  on public.leads
  for update
  to authenticated
  using (true)
  with check (true);
