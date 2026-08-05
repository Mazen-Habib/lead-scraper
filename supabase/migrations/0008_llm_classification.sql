-- Layer 3 classification (roadmap: LLM fallback for leads the rules pass and
-- the web-tagger pass both left unclassified or low-confidence). `industry`,
-- `tags`, `sub_industries`, `tag_confidence` and `tag_source` already exist
-- (0003) and already accept tag_source='llm' — this only adds the two columns
-- needed for idempotency and audit: which model produced the tag, and when.
alter table public.leads add column if not exists llm_model text;
alter table public.leads add column if not exists classified_at timestamptz;

-- The classification job's candidate query is "tag_source is null/rules/web
-- and tag_confidence < threshold, or never touched by this model version" —
-- this partial index keeps that scan cheap as the table grows, without
-- indexing the (large) majority of rows that are already confidently tagged.
create index if not exists leads_llm_candidates_idx
  on public.leads (tag_confidence)
  where tag_source is distinct from 'llm' or tag_confidence is null;
