# knowledge.md — orientation for a new Claude session

> Read this first. It tells you what this project is, what state it's in right now, and
> what just happened in the most recent work session so you don't repeat it or contradict it.
> For the full architecture deep-dive, see [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) (written
> for external AI consultation — more exhaustive, slightly less current on the newest changes).

---

## What this is

A B2B lead-generation platform: a Node.js scraper pulls company listings from business
directories/maps, enriches them with emails/socials, classifies + scores them, and pushes
everything to a Supabase Postgres table that a Next.js dashboard reads from.

Two apps in one repo:
- `src/` — the Node.js 20 ESM scraper + quality pipeline (the engine)
- `free-nextjs-admin-dashboard-main/` — the Next.js dashboard (the UI)
- `shared/` — `taxonomy.json` / `regions.json` / `sourceTargets.json`, consumed by **both**
  apps so classification vocab never drifts. `npm run sync-shared-data` keeps the
  dashboard's vendored copy in sync; `sync-shared-data:check` gates CI on it.

Supabase is the single source of truth. CSVs under `output/` are a secondary/dev-fallback
artifact, but `output/leads-master.csv`, `output/all.csv`, and `output/runs/*.csv` are
**committed to git** on purpose (see workflows below) — don't gitignore them.

---

## Most recent session: "no missing leads tolerated" + general local business expansion

User's ask, verbatim intent: guarantee zero silent lead loss, broaden the ICP beyond
tech/marketing to general local business (dentists, hospitals, "many more," Pakistan +
abroad), and produce a standing complete `all.csv` export. Approved plan is archived at
`C:\Users\hp\.claude\plans\elegant-munching-locket.md` if you need the original spec.

### What shipped (commit `04a8c1a`, pushed to `origin/main`)

1. **ICP broadened** — [src/quality/qualityFilter.js](src/quality/qualityFilter.js)'s
   `DEFAULT_CATEGORY_KEYWORDS` grew from ~45 tech-only keywords to ~85, adding healthcare,
   professional services, hospitality/retail, home/construction, and education. Genuine
   junk (cemetery, parking garage, government office) still correctly rejected.
   **Gotcha already hit and fixed once:** `config.json` used to carry its own
   `qualityFilter.categoryKeywords` override that *shadowed* this list entirely. It's been
   deleted from config.json — if you ever see it reappear, know that it silently overrides
   the code-level list and needs to go.

2. **Taxonomy grew 12 → 17 industries** — [shared/taxonomy.json](shared/taxonomy.json)
   gained `healthcare`, `professional-services`, `hospitality-retail`, `home-construction`,
   `education-training`. Run `npm run sync-shared-data` after ever editing this file.

3. **New scrape sources**, both wired through `src/sources/index.js`'s `SOURCE_REGISTRY`:
   - `googleMapsGeneral` — a **separate** registry key from the existing tech `googleMaps`
     entry, 161 queries (dentists/hospitals/law firms/restaurants/schools across ~30
     Pakistani + international cities), config at `config.googleMapsGeneral`.
   - `openStreetMap` — re-enabled (was `enabled: false`), now vertical-aware. Tag filters
     live in [src/scrapers/openStreetMap.js](src/scrapers/openStreetMap.js) as
     `TECH_TAG_FILTERS` / `HEALTHCARE_TAG_FILTERS` / `GENERAL_BUSINESS_TAG_FILTERS`;
     `config.json`'s `openStreetMap.verticals` references them **by name only**
     (`{name: 'healthcare', cities: [...]}`) — the JSON never duplicates the actual filter
     arrays, `buildJobs` resolves the name via a lookup map.

4. **Second weekly workflow** — new
   [.github/workflows/weekly-scrape-general.yml](.github/workflows/weekly-scrape-general.yml),
   runs Wednesdays (vs the existing tech run's Sundays) via a new `--only=key1,key2` CLI
   flag on `src/index.js`, so the new verticals get their own time budget and never risk
   timing out the existing 6-hour tech run.

5. **Silent-data-loss hole closed** — [src/lib/pushToSupabase.js](src/lib/pushToSupabase.js)
   `syncLeadsToSupabase` now: retries a failing batch 3x with 2s/5s backoff → if still
   failing, writes the original lead rows to `output/sync-failures-<timestamp>.csv`
   (recoverable via `scripts/backfill-supabase.js`) instead of discarding them → returns
   `{synced, failed, recoveryPath}`, and `src/index.js`'s `main()` sets
   `process.exitCode = 1` if `failed > 0` so CI goes red instead of reporting a clean run
   on partial loss. This closes the exact incident that motivated the whole session: a
   batch upsert failure had silently dropped ~2,489 of 4,672 scraped leads while CI
   reported success (already recovered via a one-off backfill earlier).

6. **`npm run export-all` → `output/all.csv`** —
   [scripts/export-all-leads.js](scripts/export-all-leads.js), reuses
   `fetchMasterFromSupabase()` (already-paginated) to write a guaranteed-complete snapshot
   of every row in Supabase. Wired as a step in **both** weekly workflows, right after the
   sync step, so it's always fresh. Refuses to overwrite `all.csv` with an empty file if
   the fetch returns zero rows (misconfiguration guard).

7. **Bonus bug found + fixed during verification, not part of the original ask:**
   [src/quality/classifier.js](src/quality/classifier.js)'s haystack builder took the last
   `/`-segment of `lead.maps_url` as a "slug" (works for directory URLs like
   `clutch.co/profile/acme-web-agency`) but Google Maps URLs end in a coordinate blob
   (`data=!4m7!3m6!1s0x...`) whose literal `"data"` substring was falsely matching the
   `data-analytics-bi` taxonomy bucket. This silently mis-tagged **75% of all Google Maps
   leads (1,542 of 2,062)** with the wrong industry. Fixed (guard: skip the slug if it
   contains `=`, `!`, or `%`) and **all 2,062 affected production rows were reclassified
   and re-synced to Supabase** as part of this session — 1,593 changed, 0 sync failures.
   If you're investigating industry-tag weirdness on old data, this is already handled;
   don't re-run the backfill unless you have a reason to believe it didn't take.

### New/changed files worth knowing about
- `src/lib/csv.js` — new, `toCsv`/`csvCell` extracted here (was private to `src/index.js`)
  so `pushToSupabase.js` can write recovery CSVs without a circular import.
- `test/openStreetMap.test.js`, `test/pushToSupabase.test.js` — new test files.
- `scripts/export-all-leads.js` — new. Needs `import 'dotenv/config'` at the top to pick up
  `.env` locally — **if you add another standalone script that touches Supabase and it
  reports "No leads returned" locally, check this first**, it's an easy one to forget since
  `src/index.js` has it but a fresh script won't automatically.

### Verified, not just written
- 111/111 unit tests pass (`npm test`).
- `npm run sync-shared-data:check` clean.
- Dashboard build (`cd free-nextjs-admin-dashboard-main && npm run build`) succeeds — new
  taxonomy entries don't break anything, the facets dropdown maps over `taxonomy.industries`
  generically.
- Live scoped scrape (`node src/index.js --only=googleMapsGeneral`, trimmed to 2 queries)
  produced 9 real dentist/hospital leads in Karachi/Lahore, correctly classified as
  `healthcare`, correctly synced to Supabase.
- `output/all.csv` row count matches Supabase's live count (5,495 after the reclassify pass).

---

## Standing rules for this project (from the user, this session and earlier ones)

- **Never run preview/browser tooling** (Claude Preview, Claude in Chrome, Playwright MCP,
  etc.) for verification unless the user explicitly asks — even for UI changes. Verify via
  `npm test`, `npm run build`, direct Node scripts, `node --check`, grep. This has held for
  multiple sessions; don't reintroduce it without being asked.
- **Production Supabase writes need fresh, explicit confirmation** via AskUserQuestion —
  even for actions that look like "obviously the right thing to do" (e.g. the bulk
  reclassify fix above was confirmed before running, despite being a pure quality
  improvement with no data loss risk). One approval doesn't carry over to the next action.
- Config.json is regenerated with `JSON.stringify(obj, null, 2)` when edited programmatically
  — this reformats some unrelated arrays (one-value-per-line vs packed). This is cosmetic
  and has been accepted as a tradeoff; don't spend time reverting pure formatting diffs.

---

## Where to look for more

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — full architecture reference (schema, scoring
  formula, all 15 sources, personalized-leads worker design, dashboard API routes). Written
  for pasting into an external AI, so it's more exhaustive but was last updated *before*
  this session's changes (still says 12 taxonomy industries / tech-only ICP — that's now
  stale, trust this file over that section until PROJECT_CONTEXT.md is refreshed).
- [ROADMAP.md](ROADMAP.md), [SOURCES.md](SOURCES.md), [DEPLOYMENT.md](DEPLOYMENT.md),
  [README.md](README.md) — supplementary docs, not touched this session.
- Known gaps as of this session (from PROJECT_CONTEXT.md, still true): LLM classifier layer
  3 exists as infrastructure (`tag_source: 'llm'`) and was built in an earlier session — it
  runs via `node src/index.js classify`, check `src/jobs/runLlmClassification.js` if asked
  about it. The ICP filter still runs *before* classification, so a truly off-ICP lead is
  dropped before the web tagger could rescue it (unchanged, not addressed this session).
