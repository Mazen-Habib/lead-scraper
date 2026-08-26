-- Country + city granularity on top of the existing continent-scale `region`
-- column — requested after region-only filtering proved too coarse (see
-- memory.md's "vasten the filters" ask). Resolved by src/quality/geography.js
-- from the same address/search_query text region already uses, via
-- shared/geo.json's country->city keyword tree.
alter table public.leads
  add column if not exists country text,
  add column if not exists city text;

create index if not exists leads_country_idx on public.leads (country);
create index if not exists leads_city_idx on public.leads (city);
