-- Supports scripts/enrichment-worker.js: without a way to record "we tried
-- and found nothing," a continuous worker would re-select the same
-- permanently-unenrichable leads (dead site, no contact info published)
-- every single cycle forever, wasting the whole point of running
-- continuously. This column lets the worker deprioritize a lead after a
-- failed attempt instead of hammering it — see the worker's ORDER BY.
alter table public.leads
  add column if not exists last_enrichment_attempt_at timestamptz;

create index if not exists leads_enrichment_attempt_idx
  on public.leads (last_enrichment_attempt_at);
