-- Named decision-maker contact, extracted free from about/team/leadership
-- pages the scraper already crawls (src/scrapers/emailFinder.js). Previously
-- the schema had nowhere for a person to live even once found — see
-- memory.md's "The schema has no contact-person fields at all" finding.
alter table public.leads
  add column if not exists contact_name text,
  add column if not exists contact_title text;
