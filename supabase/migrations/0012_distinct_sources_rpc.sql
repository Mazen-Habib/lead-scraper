-- Fixes a real production bug found while investigating the dashboard's
-- "Sources" filter dropdown: fetchLeadFacets() in src/lib/leads.ts ran
-- `.select("source").not("source","is",null)` with no explicit range/limit,
-- which silently truncates to PostgREST's default 1000-row cap. Verified
-- live against production: the naive query returns exactly 1000 rows, and
-- happened to surface only 'businesslist_ng'/'businesslist_pk' (this
-- session's most recent large inserts) — the true distinct set, confirmed
-- by paginating through the whole 15,927-row table, is 13 real sources plus
-- one empty-string value. Customers filtering by source saw 2 of 13+ options.
--
-- Fixed at the database layer (SELECT DISTINCT server-side) rather than by
-- paginating client-side, since the table is expected to keep growing toward
-- the 150k/month target and re-fetching every row on every page load to
-- compute a dropdown list doesn't scale.
create or replace function public.distinct_lead_sources()
returns table (source text)
language sql
stable
as $$
  select distinct l.source
  from public.leads l
  where l.source is not null and l.source <> ''
  order by l.source;
$$;
