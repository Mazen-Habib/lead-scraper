-- Adds real classification/firmographic columns (roadmap Phase 3) so leads
-- can be filtered by industry/tags/firm size instead of substring-matching
-- category/company_name at query time. Additive only — nothing reads these
-- columns until the classifier (src/quality/classifier.js) populates them
-- and the query layer (Phase 4) starts filtering on them.
alter table public.leads add column if not exists tags text[] default '{}';
alter table public.leads add column if not exists industry text;
alter table public.leads add column if not exists sub_industries text[] default '{}';
alter table public.leads add column if not exists employee_count integer;
alter table public.leads add column if not exists firm_size_band text;
alter table public.leads add column if not exists is_enterprise boolean default false;
alter table public.leads add column if not exists tag_confidence numeric;
alter table public.leads add column if not exists tag_source text;

create index if not exists leads_tags_gin_idx on public.leads using gin (tags);
create index if not exists leads_sub_industries_gin_idx on public.leads using gin (sub_industries);
create index if not exists leads_industry_idx on public.leads (industry);
create index if not exists leads_firm_size_band_idx on public.leads (firm_size_band);
