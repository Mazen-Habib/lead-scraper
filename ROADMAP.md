# Roadmap

Where this repo goes next. Everything here is **additive** — the weekly scrape, the CSV
outputs, the Supabase sync, and the dashboard keep working exactly as they do today at
every step. Nothing in the current pipeline gets removed or rewritten out from under a
working run.

> Current state and how it works today: **[README.md](README.md)** ·
> **[SOURCES.md](SOURCES.md)** · **[DEPLOYMENT.md](DEPLOYMENT.md)**

---

## 1. Where we actually are

Measured against `output/leads-master.csv` (4,454 rows) and 12 commits of run history on
2026-08-05, not against what the docs claim.

### Working well

| | |
|---|---|
| **Sources** | 13 wired across 2 engines, full `source`/`engine` provenance on every row |
| **Contact coverage** | website 97.6%, email 83.7%, linkedin 61.7%, phone 31.2% |
| **Email verification** | 3,688 `alive` / 34 `dead` / 5 `unknown` via free MX check |
| **Scoring** | 4-pillar 0–100 score + A/B/C/D tiers, A:684 B:1235 C:2535 |
| **Delivery** | Supabase `leads` table + Next.js dashboard, RLS read-only, live |
| **Automation** | weekly GitHub Action, commits CSVs back, uploads run artifacts |

### Two problems that gate the roadmap

**A. The "master" list does not accumulate.**
[`src/index.js`](src/index.js) reads prior state from `output/master.json`, but that file is
in [`.gitignore`](.gitignore) and therefore never committed. CI checks out fresh each run →
no `master.json` → `mergeMaster([], thisRun)` → "master" is only the current run.

Evidence — a real accumulator cannot shrink, and the 30-day prune could not have fired yet
(earliest leads are 2026-07-13):

| Date | Commit | `leads-master.csv` rows |
|---|---|---|
| 2026-07-25 | 1052447 | 4712 |
| 2026-07-29 | 1dedc92 | 4323 ⬇ |
| 2026-07-30 | cb24e3c | 4633 ⬆ |
| 2026-08-01 | ec30eeb | 4455 ⬇ |

Confirming signal: all 4,454 rows carry the identical `scraped_at` of `2026-08-01`.

Consequences:
- `output/leads-master.csv` is a per-run snapshot, not a master. The real archive is
  `output/runs/*.csv`.
- **Supabase is the de-facto master** — `syncLeadsToSupabase` upserts and there is no
  `DELETE` anywhere in the codebase, so the DB is the only store that accumulates.
- DB row count and CSV row count drift apart permanently. Stale or bad leads never leave
  the dashboard.
- Latent second bug: `mergeMaster` only fills *empty* fields on an existing key, so
  `scraped_at` is never refreshed on re-discovery. Once `master.json` persists,
  `pruneExpired(…, 30)` would delete every lead 30 days after **first** sighting even if
  re-found weekly. Fixing the persistence bug alone makes this worse.

**B. `category` is 91% noise.**

```
1835  "software / open source"   ← hardcoded literal in the githubOrgs scraper
1195  "Software company"         ← Google Maps' generic label
1008  "software developer"       ← Clutch / TopDevelopers
  80  "Computer support and services"
  80  "Website designer"
   …long tail of 1–17
```

Three values cover 4,038 of 4,454 rows. So the dashboard's 12 `SERVICES` buckets in
[`LeadsTable.tsx`](free-nextjs-admin-dashboard-main/src/components/leads/LeadsTable.tsx),
which match against `category + search_query + company_name`, are effectively matching the
query *we* typed and the company's own name — not any classification of the business. The
"AI / ML" filter finds companies with "AI" in the name, not AI companies. The scorer's
`PREMIUM_KEYWORDS` bonus has the same weakness.

There is no `tags` column, no industry taxonomy, no normalized firm size (`company_size` is
free text at 20% fill), and no enterprise/SMB signal.

### Smaller findings, carried into the phases below

- **No auth of any kind.** No `supabase.auth`, no `next-auth`, no `middleware.ts`. The
  `signin`/`signup` pages are inert TailAdmin template UI.
- **Frontend loads the entire table on every request.** `fetchLeads()` pages through every
  row (1000 at a time) on every page load (`force-dynamic`), then filters client-side.
  ~2MB per navigation at today's size.
- **`main()` cannot be partially invoked.** Source loops, filtering, scoring, file writing,
  and DB sync are one linear 530-line script. There is no `process.argv` handling anywhere
  in `src/`.
- **The lead shape is hand-maintained in five places** — `CSV_COLUMNS`, the SQL table,
  `toRow()`, `LeadRow`, `Lead`. Adding a column is five edits plus a migration.
- **Five sources contribute 0 rows** — `eventbrite`, `openstreetmap`, `opencorporates`
  (enabled but empty), `techbehemoths`, `selectedfirms` (added recently, cron hasn't run).
- **`config.outputFile` is dead** — never read by any code.
- **Secrets in git** — `creds_ScrapeGraph.txt` is tracked with live Groq keys.
  `.gitignore` covers `*credentials*.txt` but not `creds_*.txt`.
- **Supabase project may be orphaned** — `.env.example` points at `jvtxbkfpvqyjunwbtzza`,
  which is not in the Supabase account currently connected to this workspace.

---

## 2. What we're building

The eight roadmap notes from `leads.txt`, mapped to status:

| # | Goal | Today | Lands in |
|---|---|---|---|
| 1 | Sources made | ✅ 13 wired, 8 producing | Phase 1 (registry), ongoing |
| 2 | Leads for a company (url-to-scrape) | 🟡 engine exists, no entrypoint | Phase 2 |
| 3 | Tech leads by firm name entered | ❌ absent | Phase 2 |
| 4 | Digital marketing leads | 🟡 config gap, not architecture | Phase 3 |
| 5 | Filters upscaled | 🟡 two disconnected systems | Phase 4 |
| 6 | Better tags for big tech firms | ❌ absent, blocked on B | Phase 3 |
| 7 | Personalized per-person live leads + cron | ❌ absent, biggest lift | Phases 5–6 |
| 8 | Top leads / runtime leads | 🟡 "top" exists, "runtime" absent | Phase 6 |

### Dependency path

```
Phase 0  Foundation & truth
  │      fix accumulation, freshness, secrets, dead config
  ▼
Phase 1  Pipeline extraction
  │      runPipeline() + source registry — makes every later phase possible
  ▼
Phase 2  On-demand scraping ────────────┐   #2 url-to-scrape, #3 firm-name
  │      CLI first, no user model yet   │
  ▼                                     │
Phase 3  Classification & tags          │   #6 tags, #4 digital marketing ICP
  │      the data-quality unlock        │
  ▼                                     │
Phase 4  Query layer & filters          │   #5 filters upscaled
  │      server-side, shared taxonomy   │
  ▼                                     │
Phase 5  Accounts & saved searches ◄────┘   #7 prerequisite
  │
  ▼
Phase 6  Job runner & live delivery         #7 personalized, #8 runtime leads
```

Phases 2 and 3 can run in parallel once Phase 1 lands. Phases 5–6 cannot start before
Phase 4 — per-user filtering over a 2MB client-side payload is not viable.

---

## 3. Phase 0 — Foundation & truth

**Goal:** make the existing numbers mean what they say, before building on top of them.
Nothing user-visible changes.

### 0.1 — Rotate and untrack the leaked credentials
- Rotate the three Groq keys in the Groq console (they are in git history from `163f746`
  and must be treated as public).
- `git rm --cached creds_ScrapeGraph.txt`; add `creds*.txt` and `*creds*.txt` to
  `.gitignore`; move the values to `.env` (already gitignored) and GitHub secrets.
- Touches: [`.gitignore`](.gitignore), `creds_ScrapeGraph.txt`, `.env.example`.
- **Do this first.** Everything else can wait; an exposed key cannot.

### 0.2 — Decide the source of truth, then make the code say so
Supabase already *is* the accumulator. Two viable paths:

| Option | Shape | Trade-off |
|---|---|---|
| **A — Supabase is master** (recommended) | Scraper reads current leads from the DB, merges, writes back. CSVs become run artifacts only. | One store, no drift, works in CI with no persisted file. Adds a DB read to every run. |
| **B — Persist `master.json`** | Commit `master.json`, or restore it via Actions cache/artifact. | Keeps the file-based design. Fragile: merge conflicts on a committed JSON blob, and CI cache eviction silently resets the master again. |

Under Option A, `output/leads-master.csv` gets renamed or regenerated as an *export of the
DB*, so its row count and the dashboard's count can never disagree.

- Touches: [`src/index.js`](src/index.js) (`loadMasterJson`, `mergeMaster`, `pruneExpired`),
  [`src/lib/pushToSupabase.js`](src/lib/pushToSupabase.js).

### 0.3 — Make `scraped_at` mean "last seen"
Split into two fields so freshness and history are both recoverable:

| Column | Meaning | Set when |
|---|---|---|
| `first_seen_at` | discovery date | first insert only |
| `last_seen_at` | most recent confirmation | every run that re-finds the lead |

Then expiry keys off `last_seen_at`, and a lead re-found every week never expires. This is
the fix that makes item #8's "top leads" trustworthy — right now every lead claims to have
been scraped on the same day.

- Touches: `src/index.js` (`mergeMaster`, `pruneExpired`, `CSV_COLUMNS`), new migration
  `supabase/migrations/0002_lead_freshness.sql`, `pushToSupabase.js`, frontend types.

### 0.4 — Retire dead config and stale artifacts
- Remove `config.outputFile` (never read) or wire it.
- Delete or regenerate the stale committed `output/leads.csv`.
- Investigate the five zero-row sources; per [SOURCES.md](SOURCES.md) house rule, a source
  that cannot produce should be documented as not-viable rather than left enabled.

### 0.5 — Confirm the live Supabase project
Verify who owns `jvtxbkfpvqyjunwbtzza`, that it is not paused, and that
`0001_create_leads.sql` is actually applied. Every later phase adds migrations to it.

**Phase 0 done when:** master row count grows monotonically across runs, `last_seen_at`
advances for re-found leads, no secrets in the working tree, and the DB row count matches
the exported CSV.

---

## 4. Phase 1 — Pipeline extraction

**Goal:** make the pipeline callable with arbitrary inputs instead of only `config.json`.
This is the single highest-leverage change in the roadmap — items #2, #3, #7 and #8 are all
blocked on it, and none of them are hard once it exists.

### 1.1 — Extract `runPipeline(leads, opts)`
Everything in `main()` after the source loops — clean → dedupe → ICP filter → email
enrichment → ScrapeGraph → MX verify → contact filter → dead-email filter → score → score
floor — is already a pure lead-array transform. Lift it into
`src/pipeline/runPipeline.js` with options for which stages to run.

`main()` then becomes: gather from configured sources → `runPipeline(...)` → write outputs.
Behaviour is byte-identical; the weekly run is unaffected.

### 1.2 — Source registry
Replace ~25 lines of near-identical `try/catch` per source in `main()` with a declarative
registry (`src/sources/index.js`): each entry declares `key`, `engine`, `scrape(params)`,
and how to expand its config block into query units. Adding a source becomes one file plus
one registry line, and — more importantly — a caller can select a *subset* of sources by
key, which on-demand and per-user runs both require.

### 1.3 — Output adapters
Separate "produce leads" from "write them somewhere". A run should be able to target the
CSV pair, Supabase, or an in-memory return value. On-demand runs (Phase 2) need the last of
these; per-user runs (Phase 6) need scoped DB writes.

**Phase 1 done when:** `npm run scrape` produces the same output as before, and a second
caller can run the same pipeline over a hand-supplied lead array without touching
`config.json` or writing any files.

---

## 5. Phase 2 — On-demand scraping (#2, #3)

**Goal:** answer "tell me about this one company" — first as a CLI, later as the job type
the portal calls. No user model needed yet.

### 2.1 — `url-to-scrape` (#2)
[`findContacts(website)`](src/scrapers/emailFinder.js) already does single-URL → emails +
socials, and `scrapegraph_enricher.py` is the LLM fallback. What's missing is the
entrypoint and the depth.

- New `src/commands/scrapeUrl.js`, invoked as `node src/index.js url <website>`.
- Deepen the crawl for this mode: `CANDIDATE_PATHS` currently stops at `/`, `/contact`,
  `/about` with a 6s timeout — right for a 4,000-lead batch, thin for a deliberate
  single-company lookup where 30s is fine. Add `/team`, `/about-us`, `/leadership`,
  `/contact-us`, `/company`, plus footer-link discovery.
- Route through `runPipeline` so the result is scored and tiered like any other lead.
- Returns a single enriched, scored lead object; optionally upserts it.

### 2.2 — Firm-name resolution (#3)
Two hops, and only the first is new work:

```
"Acme Solutions"  ──resolve──►  acme-solutions.com  ──2.1──►  full enriched lead
```

- Resolver strategies, in fallback order: Google Maps query (already takes free text,
  needs a "best single match" mode rather than "top 40 results"), GitHub org lookup,
  then a directory search across Clutch/GoodFirms/TopDevelopers.
- Needs a confidence score and fuzzy name matching — `dedupeKey` currently falls back to
  raw `name.trim().toLowerCase()`, so "Acme Corp" and "Acme Corporation" are two leads.
  Normalizing legal suffixes (Inc/LLC/Ltd/Pvt/FZ-LLC) belongs here and improves dedupe
  everywhere else as a side effect.
- Batch input: `node src/index.js firms firms.txt` — one name per line. This is the
  "can be time taking but totally doable" path; expect ~10–30s per firm, so it wants
  progress output and resumability.

**Phase 2 done when:** a URL or a list of firm names produces scored, verified leads
through the same pipeline the weekly run uses.

---

## 6. Phase 3 — Classification & tags (#4, #6)

**Goal:** fix problem B. Give every lead a real, queryable classification independent of
whatever string the source happened to supply.

### 3.1 — Tag schema
New columns, additive — nothing reads them until 3.4:

| Column | Type | Example |
|---|---|---|
| `tags` | `text[]` | `{ai-ml, saas, enterprise}` |
| `industry` | `text` | `software-development` |
| `sub_industries` | `text[]` | `{mobile-apps, devops}` |
| `employee_count` | `int` | `250` (parsed from `company_size`) |
| `firm_size_band` | `text` | `solo` / `small` / `mid` / `large` / `enterprise` |
| `is_enterprise` | `bool` | derived |
| `tag_confidence` | `numeric` | 0–1, so low-confidence tags can be filtered |
| `tag_source` | `text` | `rules` / `llm` / `manual` |

GIN index on `tags` and `sub_industries`. Migration `0003_lead_tags.sql`.

### 3.2 — Rules-based classifier (first pass, deterministic, free)
`src/quality/classifier.js`. Inputs it can use that the current filter ignores: website
domain and TLD, page content already fetched during enrichment, `search_query`,
`profile_url` slug (Clutch/DesignRush category slugs are far better labels than the
`category` field), source-specific fields, and the raw `category`.

The 12 `SERVICES` buckets currently hardcoded in `LeadsTable.tsx` are the natural starting
taxonomy — but they move **out of the component and into shared config** so the scraper,
the API, and the UI all use one definition.

### 3.3 — LLM classifier (second pass, for what rules can't resolve)
The Groq/Mistral key-rotation harness in
[`scrapegraph_enricher.py`](src/scrapers/scrapegraph_enricher.py) already exists and is
proven. Extend it with a `classify` mode: feed the homepage text, get back taxonomy tags
with confidence. Run it only where rules return low confidence, to stay inside free tiers.

### 3.4 — Normalize firmographics
Parse `company_size` ("50 - 249", "1,000+") into `employee_count` and `firm_size_band`;
parse `hourly_rate` into a numeric band. These are the actual "big tech firm" signal — a
1,000-person firm with a $150/hr floor is categorically different from a 5-person shop, and
today both are indistinguishable strings at 20% fill.

### 3.5 — Backfill and re-score
Run the classifier over the existing corpus (`rescore.js` is the precedent for a one-shot
re-processing script), then extend `scorer.js` to use real tags instead of the
`PREMIUM_KEYWORDS` substring hack.

### 3.6 — Digital marketing ICP (#4)
Only ~90 of 4,454 rows (2%) are marketing-adjacent, and the causes are all config:

- **0 of 110** Google Maps searches mention marketing/SEO/advertising/branding — they are
  all `software | IT | web | app | fintech | AI companies in <city>`.
- All 47 Clutch directories are dev/IT slugs. Clutch has marketing directories; none are
  listed.
- DesignRush already queries `digital-marketing` per country — it is the only source
  pulling this ICP, and it contributed 78 rows total.
- `qualityFilter.categoryKeywords` has `agency`/`digital`/`studio` but lacks `marketing`,
  `seo`, `ppc`, `advertising`, `branding`, `media`, `content`, `growth`. A firm categorized
  "Search Engine Optimization Service" is **dropped before enrichment**.

Sequenced *after* 3.1–3.5 deliberately: widening the ICP without tags means a dev shop and
an SEO shop become indistinguishable in the dashboard. With `industry` in place, they're
separable, and "digital marketing" becomes a first-class vertical rather than dilution.

Work: add marketing search queries and directory slugs to `config.json`, extend the ICP
keywords, add marketing sub-industries to the taxonomy, verify DesignRush/Clutch marketing
directory coverage.

**Phase 3 done when:** every lead has `industry` + `tags` with confidence, `employee_count`
is numeric where the source provided size, and filtering by "AI companies" returns AI
companies rather than companies with "AI" in the name.

---

## 7. Phase 4 — Query layer & filters (#5)

**Goal:** move filtering from the browser to the database, over the taxonomy Phase 3
created. Prerequisite for anything per-user.

### 4.1 — Server-side query API
`fetchLeads()` currently pages through every row on every page load and filters
client-side. Replace with a filtered, paginated, sorted query — `GET /api/leads` taking
tier, source, industry, tags, region, score range, has-email, text search, page, sort.
Postgres does the work; the browser receives a page.

The existing full-fetch path stays as a fallback until the new one is proven.

### 4.2 — Region as data, not a component constant
The 7 `REGIONS` keyword arrays live only inside `LeadsTable.tsx` and are matched against
`address + search_query`. Promote to real columns (`country`, `region`, `city`) resolved at
scrape time — most sources already provide location, and the geography is implicit in the
config query that found the lead. Then region filtering is an indexed equality check.

### 4.3 — Composable filter model
With `industry`, `tags`, `region`, `firm_size_band`, `score`, and `email_verified` as real
columns, filters compose server-side instead of being one hardcoded predicate chain. This
is also the shape a saved search serializes to in Phase 5.

### 4.4 — Filter UI rebuild
Multi-select instead of single-select dropdowns, tag chips, size and score range sliders,
saved-filter presets. The existing `QUICK_TARGETS` presets become the seed data for saved
searches.

**Phase 4 done when:** the leads page loads a page of rows rather than the whole table, and
every filter is expressible as a URL/query object that the backend executes.

---

## 8. Phase 5 — Accounts & saved searches (#7 prerequisite)

**Goal:** introduce the concept of a user. Nothing personalized can exist before this.

### 5.1 — Supabase Auth
The DB is already Supabase, so Auth gives per-user rows under the same RLS model with no
new infrastructure. The `signin`/`signup` pages exist as UI and need wiring; add
`middleware.ts` for route protection. Public read on `leads` stays or narrows — decide
whether the corpus remains shared or becomes per-user.

### 5.2 — Schema
```
users              (Supabase auth.users)
saved_searches     id, user_id, name, filter_json, schedule, is_active, created_at
user_leads         user_id, lead_id, saved_search_id, status, notes, first_delivered_at
scrape_runs        id, user_id, saved_search_id, trigger, status, started_at,
                   finished_at, leads_found, error
```
`user_leads` is what makes a lead "theirs" — the shared `leads` corpus stays deduped
globally, and per-user state (seen/contacted/dismissed) lives in the join table. RLS scopes
all three new tables to `auth.uid()`.

### 5.3 — Saved search UI
Persist the Phase 4 filter object with a name and an optional schedule. This is the
"per the person's search" half of #7.

**Phase 5 done when:** a user can sign in, save a named search, and see only their own
saved searches and lead states.

---

## 9. Phase 6 — Job runner & live delivery (#7, #8)

**Goal:** a saved search runs on a schedule or on demand, and its results flow to that
user. The "runtime live leads" half of #7 and all of #8.

### 6.1 — Choose the execution host
GitHub Actions runs the weekly job well and should keep doing so. It is the wrong host for
per-user on-demand jobs: concurrency limits, ~2min cold start for `npm ci` + Playwright +
pip, a 6h timeout, and results delivered by `git push`.

| Option | Fit |
|---|---|
| **Always-on worker** (Railway / Fly / VPS) | ✅ Recommended. Playwright and CloakBrowser both work; long-running jobs are fine. |
| **Supabase Edge Functions** | ❌ For cloak/Playwright sources. Cannot run a browser binary. Viable only for API-only sources. |
| **Keep GitHub Actions** | ⚠️ Workable for scheduled per-user runs via `workflow_dispatch`; poor for interactive. |

A hybrid is realistic: keep the weekly corpus-wide scrape on Actions, add a small worker
for user jobs.

### 6.2 — Job queue
`scrape_runs` as the queue table; worker polls or listens via Supabase Realtime. Each job:
resolve the saved search filter into source queries → `runPipeline` (Phase 1) → dedupe
against the global corpus → link results into `user_leads` → mark the run finished.

Needs rate limiting per user, retries with backoff, and cancellation.

### 6.3 — Per-user cron
The scheduled half of #7. `saved_searches.schedule` drives it — the worker wakes hourly,
finds due searches, enqueues runs. New leads for a user surface as unread in `user_leads`.

### 6.4 — Live run UI
Trigger a run from the portal, watch status (queued → running → done), see leads land as
they're found. Supabase Realtime on `scrape_runs` and `user_leads` gives the live feed
without polling.

### 6.5 — Top leads & runtime leads views (#8)
- **Top leads** — partly exists (dashboard Top-10, tier badges). Upgrade to a real view
  once Phase 0.3 makes freshness meaningful and Phase 3 makes tags real: top *within a
  saved search*, top *this week*, top *newly discovered*.
- **Runtime leads** — the live feed from 6.4: leads arriving now, for this user, from this
  run.
- Notifications (email/in-app) when a scheduled run finds Tier A matches.

**Phase 6 done when:** a user saves a search, it runs on schedule and on demand, and new
matching leads appear in their portal without anyone touching `config.json`.

---

## 10. Open decisions

These change the shape of the work and are worth settling before the phase they gate.

1. **Source of truth — Supabase or files?** (gates Phase 0.2)
   Recommendation: Supabase. It is already the only accumulating store.
2. **Execution host for per-user jobs?** (gates Phase 6.1)
   Recommendation: small always-on worker; Edge Functions cannot run the cloak engine.
3. **Is the lead corpus shared or per-user?** (gates Phase 5.2)
   Shared corpus + `user_leads` join is cheaper and dedupes better; per-user silos are
   simpler to reason about but multiply scraping cost.
4. **Is digital marketing a second ICP or a replacement?** (gates Phase 3.6)
   Determines whether the taxonomy is multi-vertical from day one.
5. **Auth provider** — Supabase Auth unless there's a reason not to.
6. **Does the free LLM tier survive classification volume?** (gates Phase 3.3)
   6 rotating keys against ~4,500 leads; rules-first keeps it inside limits.

---

## 11. Non-goals

- Rewriting the scrapers. They work; they get called differently, not rebuilt.
- Replacing the dashboard template.
- Paid data APIs (Apollo, Hunter, Clearbit) — see [RESEARCH.md](RESEARCH.md) if free
  sources are outgrown.
- Login-gated or ToS-hostile sources. The "Evaluated, not viable" table in
  [SOURCES.md](SOURCES.md) stands.
- Outreach automation (sending email). Compliance notes in [RESEARCH.md](RESEARCH.md)
  explain why that is a separate decision.

---

## 12. File touchpoint map

Where each phase lands, for orientation:

| Phase | Primary files |
|---|---|
| 0 | `.gitignore`, `creds_ScrapeGraph.txt`, [`src/index.js`](src/index.js), [`src/lib/pushToSupabase.js`](src/lib/pushToSupabase.js), `supabase/migrations/0002_*` |
| 1 | new `src/pipeline/`, new `src/sources/`, [`src/index.js`](src/index.js) |
| 2 | new `src/commands/`, [`src/scrapers/emailFinder.js`](src/scrapers/emailFinder.js), [`src/lib/normalizeUrl.js`](src/lib/normalizeUrl.js), [`src/scrapers/googleMaps.js`](src/scrapers/googleMaps.js) |
| 3 | new `src/quality/classifier.js`, new `src/taxonomy/`, [`src/quality/scorer.js`](src/quality/scorer.js), [`src/scrapers/scrapegraph_enricher.py`](src/scrapers/scrapegraph_enricher.py), `supabase/migrations/0003_*`, [`config.json`](config.json) |
| 4 | [`free-nextjs-admin-dashboard-main/src/lib/leads.ts`](free-nextjs-admin-dashboard-main/src/lib/leads.ts), [`.../app/api/leads/route.ts`](free-nextjs-admin-dashboard-main/src/app/api/leads/route.ts), [`.../components/leads/LeadsTable.tsx`](free-nextjs-admin-dashboard-main/src/components/leads/LeadsTable.tsx) |
| 5 | `supabase/migrations/0004_*`, `.../middleware.ts`, `.../components/auth/`, `.../lib/supabaseClient.ts` |
| 6 | new worker service, `supabase/migrations/0005_*`, new portal routes |

Schema note: any new lead column must be added in **five** places — `CSV_COLUMNS` in
[`src/index.js`](src/index.js), the SQL migration, `toRow()` in
[`pushToSupabase.js`](src/lib/pushToSupabase.js), `LeadRow` in
[`leads.ts`](free-nextjs-admin-dashboard-main/src/lib/leads.ts), and `Lead` in
[`lead-types.ts`](free-nextjs-admin-dashboard-main/src/lib/lead-types.ts). Consolidating
these into one generated definition is a worthwhile side-quest during Phase 3.
