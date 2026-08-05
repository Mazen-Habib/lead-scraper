# Lead Gen Portal — Complete Project Context

> Paste this whole document to an AI assistant as background before asking questions about the project.

---

I'm building a **B2B lead generation platform**. Below is the complete context — business purpose, architecture, every technical detail, current status, and known gaps. Read it fully, then help me with the questions at the end.

---

## 1. What it is, in plain language

It automatically finds companies that could become clients, works out how to contact them, judges how good a prospect each one is, and presents them in a web dashboard I can filter and export. It runs itself on a schedule, and individual users can ask it to go hunt for leads matching their own criteria.

Concretely: it visits business directories and maps listings, pulls out company names, websites, emails and phone numbers, visits each company's own website to find more contact details, checks the emails are real, tags each company by industry and region, scores it 0–100, and stores everything in a database behind a login-protected dashboard.

**Target market:** software/IT/digital-agency companies, focused on the Middle East, South Asia, Southeast Asia, Africa, Europe, North America and APAC/ANZ.

---

## 2. Architecture

Two separate applications in one repo:

```
D:\Lead_Gen_Portal\lead-scraper\
├── src/                              # Node.js scraper + data pipeline (the backend engine)
├── free-nextjs-admin-dashboard-main/ # Next.js dashboard (the UI)
├── shared/                           # taxonomy.json, regions.json, sourceTargets.json (shared vocab)
├── supabase/migrations/              # 0001–0007 SQL migrations
├── test/                             # node:test unit tests (71 tests, 12 files)
├── .github/workflows/                # weekly-scrape.yml, personalized-scrape.yml
├── config.json                       # what to scrape (sources, queries, filters, thresholds)
└── output/                           # CSVs (run files + accumulated master)
```

**Data flow:**
```
Directories/Maps → scrapers → quality pipeline → Supabase `leads` table → Next.js dashboard → user
                                                        ↑
                                        personalized worker (per-user scrapes)
```

Supabase (Postgres) is the single source of truth. CSVs are a secondary artifact/local-dev fallback.

---

## 3. Tech stack

**Scraper (root):** Node.js 20, ES modules (`"type": "module"`), Playwright + patchright + `cloakbrowser` (anti-bot browser), Cheerio (HTML parsing), `@supabase/supabase-js` (service-role key), `csv-writer`, `dotenv`. Optional Python: ScrapegraphAI + langchain-groq + langchain-mistralai for LLM enrichment.

**Dashboard:** Next.js 16.1.6 (App Router, Turbopack), React 19.2, TypeScript, Tailwind CSS, `@supabase/ssr` (cookie-based auth), `zod` (validation), ApexCharts (charts). Built on the TailAdmin template (unused template pages have been deleted).

**Infra:** Supabase Postgres + Auth + RLS. GitHub Actions for scheduled/triggered scraping. No dedicated server.

---

## 4. The scraper — 13 sources

Declared in a registry (`src/sources/index.js`) where each entry knows how to turn its slice of `config.json` into scrape jobs. Two engine types:

**`normal_scraper`** (plain HTTP/Playwright): Google Maps, OpenStreetMap, GitHub Orgs, OpenCorporates, PSEB/TechDestination, TopDevelopers, Eventbrite.

**`cloak_browser`** (cloakbrowser, for anti-bot-protected sites): Clutch, GoodFirms, Sortlist, DesignRush, TechBehemoths, SelectedFirms.

Each source has its own scraper in `src/scrapers/`. Sources are individually enabled/disabled in `config.json`. `gatherLeads(config, cloak, { only })` runs them all (or a subset) and stamps provenance (`source`, `engine`, `search_query`, `scraped_at`) on every lead.

**Resilience:** each job is wrapped in `withRetry` — 3 attempts with 2s/5s backoff. A source that still fails is logged and skipped; one broken directory never aborts the run.

---

## 5. The quality pipeline

`src/pipeline/runPipeline.js` — a pure lead-array transform (no file/DB side effects) shared by every entry point. Exact order:

1. **`cleanLead`** — decode `%20`, strip HTML tags/entities, normalise whitespace on every field.
2. **`dedupe`** — merge-dedupe by `dedupeKey`. Keeps the *richest* merged record (Clutch gives rating/company_size, GitHub gives email — both survive).
   - `dedupeKey(lead) = normalizeUrl(lead.website) || normalizeName(lead.name)`
3. **`filterByIcp`** — drops companies whose category/name matches no ICP keyword (`software, tech, web, app, digital, cloud, data, marketing, seo…`).
4. **If `findEmails`:**
   - **`enrichLeads`** (`emailFinder.js`, concurrency 15) — crawls each company website (`/`, `/contact`, `/about`; deep mode adds `/team`, `/about-us`, `/leadership`, `/contact-us`, `/company` + footer-link discovery). Extracts emails via `mailto:` links and regex, filters junk (asset filenames, `sentry`, `example.com`, placeholders), and grabs LinkedIn/Facebook/Instagram URLs.
   - **ScrapegraphAI enrichment** (optional, Python subprocess) — LLM pass for leads still missing an email.
   - **`verifyLeads`** — DNS MX lookup per email domain → `alive` / `dead` / unknown.
5. **`filterByContactPoint`** — must have phone OR LinkedIn OR a non-dead email.
6. **`filterByDeadEmailOnly`** — drops leads whose only contact is a confirmed-dead email.
7. **`classifyLeads`** — rules-based taxonomy classification (see §6).
8. **`tagLeadsFromWeb`** — website-based tagging fallback (see §6).
9. **`normalizeFirmographics`** — parses `company_size` strings into `employee_count`, `firm_size_band`, `is_enterprise`.
10. **`resolveRegions`** — maps address text to a region slug via keyword matching.
11. **`scoreLeads`** — 0–100 score + A/B/C/D tier (see §7).
12. **`filterByScore`** — drops below `config.quality.minScore` (default 35).
13. Sort by score descending.

**After the pipeline** (weekly run only, `src/index.js`): write per-run CSV → load existing master from Supabase → `pruneExpired` (drop leads unseen for 30 days) → `mergeMaster` (preserves `first_seen_at`, advances `last_seen_at`) → **re-score the entire master** so old rows reflect current scoring logic → write `master.json` + `leads-master.csv` → `syncLeadsToSupabase` (upsert on `dedupe_key`).

---

## 6. Classification and tagging (3 layers)

Shared vocabulary in `shared/taxonomy.json` — **12 industries**, used identically by scraper, API and UI so they never drift:

`data-analytics-bi, web-development, mobile-apps, ai-ml, ecommerce, cloud-devops, cybersecurity, erp-sap, blockchain, ui-ux-design, qa-testing, digital-marketing`

**`shared/regions.json`** — 7 regions with city/country keywords: `middle-east, south-asia, southeast-asia, africa, europe, north-america, apac-anz`

**Firm size bands:** `solo (≤1), small (≤10), mid (≤249), large (≤999), enterprise (1000+)`

### Layer 1 — Rules classifier (`src/quality/classifier.js`)
Matches taxonomy keywords against a "haystack" of category + name + search_query + website domain words + directory URL slug. Highest keyword-hit count wins as `industry`; all matching buckets become `tags`. Confidence `min(0.95, 0.5 + 0.1×hits + 0.1×margin)`. Sets `tag_source: 'rules'`.

### Layer 2 — Web tagger (`src/quality/webTagger.js`) ← recently added
**Problem it solves:** the rules pass only sees metadata. Realistic generic categories like `"Software Company"`, `"IT Services"`, `"Technology Solutions"` pass the ICP filter but match **no** taxonomy bucket — I measured **9 of 10** sampled generic categories classifying as `null`. Those leads reached the database untagged and got filtered out as noise despite being good leads.

**How it works:** for leads the rules pass left unclassified *and* that have a website, fetch the homepage as clean Markdown via **Jina Reader** (`https://r.jina.ai/<url>` — free, no API key) and re-run the same taxonomy matcher over the real prose. Sets `tag_source: 'web'`.

**Deliberately conservative:**
- Never overwrites a rules-classified lead
- **Whole-word matching** for page prose (substring matching would hit `"bi"` inside `"ambient"`, `"etl"` inside `"kettle"`)
- Requires ≥2 keyword hits, so one incidental `"cloud"` can't mislabel a company
- Confidence capped at 0.75 (below rules' 0.95), leaving room for a future LLM pass
- Every fetch failure is a silent skip — must never break a 6-hour run

**Two gotchas discovered while building it:**
1. A full Chrome User-Agent gets **403'd** — Cloudflare in front of `r.jina.ai` serves a JS challenge to anything claiming to be a browser. A plain descriptive UA (`lead-scraper/1.0 (+url)`) is served normally.
2. Jina's keyless tier allows **~20 requests/minute**. Unpaced concurrency produced a wall of 429s that *silently* lost most tags while still appearing to succeed. Now paced at **18 req/min** behind a shared pacer, with one retry on 429.

Config: `webTagging: { enabled, concurrency: 3, requestsPerMinute: 18, maxLeads: 300, timeoutMs: 20000, minKeywordHits: 2 }`

### Layer 3 — LLM classifier
Not built yet. `tag_source` already supports `'llm'`.

---

## 7. Scoring (`src/quality/scorer.js`)

0–100 across four weighted pillars:

**Reachability (35):** MX-verified email +22 / unverified email +12 / dead email +0; phone +8; LinkedIn +7; website +3; multiple emails +2

**Credibility (35):** rating ≥4.7 +15, ≥4.5 +12, ≥4.0 +8, ≥3.5 +4, >0 +1; reviews ≥200 +15, ≥100 +12, ≥50 +8, ≥20 +5, ≥5 +2; company_size +3; hourly_rate +2

**Source quality (20):** clutch 20, goodfirms 18, topdevelopers 14, designrush 12, sortlist 12, google_maps 10, github_orgs 8, pseb 8, openstreetmap 6, opencorporates 6, eventbrite 5, unknown 5

**Profile completeness (10):** address +2; min_project +2; facebook/instagram +1

**Bonuses (uncapped, then clamped to 100):** premium ICP industry (`ai-ml, cloud-devops, cybersecurity, erp-sap, blockchain, data-analytics-bi`) +5; `is_enterprise` +3

**Tiers:** A ≥75 · B ≥55 · C ≥35 · D below

---

## 8. Database schema (Supabase Postgres)

### `leads` — the shared corpus
`id`, `dedupe_key` (unique), `company_name`, `category`, `website`, `email`, `all_emails`, `phone`, `address`, `linkedin`, `facebook`, `instagram`, `rating`, `review_count`, `company_size`, `hourly_rate`, `min_project`, `search_query`, `profile_url`, `source`, `engine`, `email_verified`, `score`, `tier`, `scraped_at`, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `industry`, `tags[]`, `sub_industries[]`, `employee_count`, `firm_size_band`, `is_enterprise`, `tag_confidence`, `tag_source`, `region`, `status`, `deleted_at`

**RLS:** `anon`+`authenticated` can SELECT where `deleted_at is null`. `authenticated` can UPDATE **only** `(status, deleted_at)` — enforced by column-level `GRANT`, since RLS is row-level not column-level. The scraper uses the service-role key and bypasses RLS entirely.

### `saved_searches`
`id`, `user_id → auth.users`, `name`, `filter_json` (jsonb), `schedule` (`off|daily|weekly`), `is_active`, `created_at`, `depth` (`quick|deep`), `last_run_at`. RLS: owner full access.

### `user_leads` — which leads were delivered to which user
`id`, `user_id`, `lead_id → leads`, `saved_search_id`, `status`, `notes`, `first_delivered_at`, **`delivery_reason`** (`fresh|backfill`), `scrape_run_id`, **`unique(user_id, lead_id)`**. RLS: owner full access.

### `scrape_runs` — per-user run status/audit
`id`, `user_id`, `saved_search_id`, `trigger` (`manual|schedule`), `status` (`pending|running|done|failed`), `started_at`, `finished_at`, `leads_found`, `error`, `created_at`. RLS: owner SELECT + owner INSERT.

**Migrations:** `0001` base leads · `0002` freshness (`first_seen_at`/`last_seen_at`) · `0003` tags/classification · `0004` region · `0005` accounts + saved searches · `0006` lead status + soft-delete · `0007` personalized runs. All idempotent (`if not exists`, `drop policy if exists` + `create policy`). All applied to the live project.

---

## 9. The dashboard

**Auth:** Supabase email/password via `@supabase/ssr`. `middleware.ts` refreshes the session cookie and protects `/`, `/leads`, `/saved-searches`, `/my-leads`; signed-in users are bounced away from `/signin`/`/signup`. (Google/X OAuth buttons exist but are intentionally inert.)

**Pages:** `/` (dashboard with tier donut, source bar chart, score histogram) · `/leads` (main table) · `/saved-searches` · `/my-leads` · `/profile` · `/signin` · `/signup` · `/error-404`

**API routes:**
- `GET /api/leads` — server-side filtered/sorted/paginated
- `GET /api/leads/facets` — distinct filter values
- `GET /api/leads/export` — CSV of the whole filtered set
- `PATCH/DELETE /api/leads/[id]` — status update / soft-delete
- `GET/POST /api/saved-searches` — list/create (POST also backfills)
- `PATCH/DELETE /api/saved-searches/[id]` — rename / toggle / delete
- `POST /api/saved-searches/[id]/run` — queue a real scrape
- `GET /api/saved-searches/[id]/runs` — run history/status
- `GET /api/my-leads` — leads delivered to this user

**Leads table:** server-side filtering by tier, source, industry, tag, region, firm-size band, min/max score, has-email, and free-text search (with escaped ilike wildcards); sortable by score/scraped_at; 50/page; debounced search; "Quick Targets" presets; CSV export; a detail drawer with copy-to-clipboard fields, a lifecycle status dropdown (`new/contacted/qualified/converted/rejected`) and a soft-delete "Remove" button.

---

## 10. Personalized runtime leads (the newest and most important feature)

**The requirement:** *"personalized leads as per the person's search — runtime live leads come in, then that cron job brings those specific leads, specifically for that person."*

**The trap I explicitly avoided:** `filter_json` is a filter over the **existing corpus** (tier, industry, region, score, hasEmail…). The tempting shortcut — a cron that re-runs that filter against the `leads` table and presents the rows as "your new live leads" — is a **bluff**: it returns the same stale rows forever. Real personalized leads require translating the filter into **actual scrape jobs**.

### Targeting (`src/personalized/targeting.js` + `shared/sourceTargets.json`)
Each source speaks a different vocabulary, so `(industry, region)` is mapped onto each one's real tokens:

| Source | Shape | Example |
|---|---|---|
| googleMaps | free text | `"AI companies in Dubai"` |
| clutch | `country/service` | `ae/developers` |
| goodFirms | country-name path | `directory/country/top-software-development-companies/united-arab-emirates` |
| designRush | `{category, country}` ISO-2 | `{software-development, AE}` |
| sortlist | `{category, country}` slug | `{software-development, ""}` |
| techBehemoths | `{service, country}` full slug | `{software-development, united-arab-emirates}` |
| selectedFirms | `{category, country}` short slug | `{software-development, uae}` |

Every token is one already proven by the curated `config.json` — nothing invented. Output is a **synthetic config object in `config.json`'s exact shape**, so it feeds straight into the existing `gatherLeads(config, cloak, { only })` with **zero scraper changes**.

- `depth: 'quick'` → Google Maps + Clutch + GoodFirms (minutes). `depth: 'deep'` → all seven.
- **Google Maps fallback:** any uncovered (industry, region) pair still gets real jobs, synthesized as `"{industry label} companies in {city}"` from the region's cities — so a filter never silently yields zero jobs.
- **Coverage gaps are reported, not hidden:** GoodFirms has no marketing directory, so `digital-marketing` reports it as skipped instead of scraping a wrong-but-plausible category.

### Worker (`src/personalized/runSavedSearches.js`) — `node src/index.js saved-searches`
1. Turn due scheduled searches into `pending` run rows (so manual and scheduled paths share one queue and one status model).
2. Claim pending runs → `running` + `started_at`.
3. **Group by scrape signature** (`industry|region|depth`) — two users wanting "AI/ML in Middle East" trigger **one** scrape, attributed to both. Cost scales with distinct searches, not users.
4. Scrape → **the same `runPipeline`** as the weekly run (identical cleaning, dedupe, enrichment, classification, web tagging, scoring — no second-class path) → `syncLeadsToSupabase` (now returns `dedupe_key → id`, because the upsert previously discarded ids that `user_leads.lead_id` needs).
5. **Attribute:** apply the filters directories can't express (tier, minScore, hasEmail, free-text) *after* scoring, then insert `user_leads` rows with `delivery_reason: 'fresh'`, relying on `unique(user_id, lead_id)` so a lead is never delivered twice.
6. Close out: `done` + real `leads_found`, or `failed` + error text. One failure never aborts the batch.

Caps: 10 runs and 5 groups per invocation; overflow returns to `pending`.

### Backfill
When a saved search is created, matching **existing** corpus leads (top 200 by score) are delivered immediately with `delivery_reason: 'backfill'` — instant value, but explicitly labelled.

### Honesty guarantees (the acceptance bar)
1. Every status the UI shows comes from a real `scrape_runs` row — no optimistic states.
2. `delivery_reason` separates `'fresh'` (a run found it) from `'backfill'` (already existed, new only to you); the UI badges them **Fresh** vs **From corpus**.
3. Zero-coverage runs say *"No source covers X in Y"* rather than succeeding emptily.
4. A dispatch failure marks the run `failed` with the reason, instead of sitting `pending` forever looking busy.
5. `leads_found` is the real attributed count.

---

## 11. Automation (GitHub Actions)

**`weekly-scrape.yml`** — Sundays 19:00 UTC (midnight PKT), 360-min cap. Installs Node/Playwright/Python, **runs `npm test` as a gate**, runs the full scrape, commits updated CSVs back to the repo, uploads run CSV as a 90-day artifact.

**`personalized-scrape.yml`** — daily 02:00 UTC + `workflow_dispatch` (fired by the dashboard's "Run now" via the GitHub API), 90-min cap, `concurrency` group so two workers never claim the same rows, `contents: read` only (results live in Supabase, nothing committed).

---

## 12. Commands

```bash
npm test                            # 71 unit tests (node --test)
npm run scrape                      # full weekly scrape
node src/index.js url <website>     # on-demand: scrape one company by URL
node src/index.js firms <file>      # on-demand: resolve firms by name (one per line)
node src/index.js saved-searches    # personalized worker
node scripts/apply-migration.js <f> # apply a SQL migration
cd free-nextjs-admin-dashboard-main && npm run dev|build|lint
```

## 13. Environment variables

**Scraper:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GITHUB_TOKEN`, `GROQ_KEY_1..3`, `MISTRAL_KEY_1..3`, `PYTHON_BIN`

**Dashboard:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `LOCAL_CSV_PATH` (dev fallback), and for "Run now": `GITHUB_DISPATCH_TOKEN` (PAT with `actions:write`), `GITHUB_OWNER`, `GITHUB_REPO`

## 14. Testing

71 tests across 12 files using Node's built-in `node:test`. Covers scoring, classification, web tagging, targeting, attribution, run grouping, scheduling, quality filters, email verification, URL normalization, geography, firmographics, master merge, firm resolution. Network calls are stubbed by replacing `globalThis.fetch`, so the suite runs fully offline.

---

## 15. Current status

**Done:** 13 sources · on-demand URL/firm scraping · full quality pipeline · rules + web classification · firmographics · region resolution · scoring/tiers · Supabase sync with freshness tracking · auth + protected routes · saved searches · server-side filtering and CSV export · lead lifecycle status + soft-delete · personalized runtime leads with per-user attribution · two CI workflows · 71 tests.

**Not done / known gaps:**
- LLM classifier layer (`tag_source: 'llm'` reserved but unimplemented)
- The full personalized user journey (save → backfill → Run now → fresh leads) is built and unit-tested but **not yet confirmed against a real signed-in account end-to-end**
- `GITHUB_DISPATCH_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO` must be configured or "Run now" fails (loudly, by design)
- The ICP filter runs **before** classification, so a lead with a truly off-ICP category is dropped before the web tagger can rescue it — reordering would increase recall
- Email notifications for new leads
- Per-user quotas/billing beyond hard caps
- Old API keys remain in git history (deliberate decision to leave for now)

**Deliberately rejected:** cookie/browser-session channels (LinkedIn, Twitter, Reddit, Instagram, Facebook) — they need a live desktop Chrome session, can't run in CI, and carry account-ban risk.

---

## 16. Design principles I'm holding to

1. **Never fake liveness.** If data is cached, say so. If a run failed, show the error. If coverage is missing, name it.
2. **Reuse one definition.** Taxonomy/regions are shared by scraper, API and UI so they can't drift.
3. **Degrade, don't crash.** Any single source, website or enrichment failure is logged and skipped; a 6-hour run never dies on one bad page.
4. **Don't invent vocabulary.** Scrape targets use tokens already proven to work.
5. **Scraper-owned vs user-owned data stay separate.** The scraper's upsert never touches `status`/`deleted_at`; column-level grants enforce it.

---

## My questions

[Replace this section with what you actually want help on. Examples:]
- How would you implement the LLM classification layer (layer 3) cost-effectively at ~5,000 leads/week?
- Is my scoring model well-calibrated, and what would you change?
- How should I reorder the ICP filter vs classification to improve recall without letting junk through?
- What's the best way to add email outreach/sequencing on top of this?
- How do I scale the personalized worker beyond GitHub Actions as user count grows?
