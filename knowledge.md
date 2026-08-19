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
- `src/` — the Node.js 24 ESM scraper + quality pipeline (the engine)
- `free-nextjs-admin-dashboard-main/` — the Next.js dashboard (the UI)
- `shared/` — `taxonomy.json` / `regions.json` / `sourceTargets.json`, consumed by **both**
  apps so classification vocab never drifts. `npm run sync-shared-data` keeps the
  dashboard's vendored copy in sync; `sync-shared-data:check` gates CI on it.

Supabase is the single source of truth. CSVs under `output/` are a secondary/dev-fallback
artifact, but `output/leads-master.csv`, `output/all.csv`, and `output/runs/*.csv` are
**committed to git** on purpose (see workflows below) — don't gitignore them.

---

## Most recent session: businesslist.pk/ng spider, provider rework, CI hardening

User's ask evolved across the session: fix the disk-space emergency that opened it → verify
the scraper still works → expand coverage into "why is this vertical so thin" → get free LLM
providers wired up (user is in Pakistan, Groq unreliable there) → scale the new source →
"never blink an eye on quality" → get it running for real in GitHub Actions.

### Free LLM provider stack — verified live, not just wired

Five Layer-3 classification providers now exist in `src/classification/providers/`: groq,
openrouter, cerebras, gemini, cloudflare. **Every one of the default models I first picked
from memory was wrong** — caught by actually calling each API with a real key rather than
trusting docs:
- OpenRouter's original default 404'd (model no longer free); also most of its current free
  pool are **reasoning models** that burn 100–260 tokens thinking before emitting content, so
  they return HTTP 200 with **empty** content at a normal token budget — `callOpenRouter` now
  detects this via `reasoning_tokens` and says so explicitly rather than "no content" being a
  mystery. Current default (`google/gemma-4-26b-a4b-it:free`) was chosen specifically because
  it reports zero reasoning tokens.
- Cloudflare's original default was a **retired model** (410, not the URL — check the model
  catalogue API, not the endpoint, when this happens again).
- **Cerebras is NOT free on this account** — every model 402s ("payment required") despite a
  valid key. Adapter works; don't route classification there without confirming billing.
- Active config: `config.json`'s `llmClassification.provider` is `"cloudflare"` (fast, genuinely
  free, verified). **OpenRouter is what backs email enrichment** — this needed a *separate*
  fix, since ScrapegraphAI (`src/scrapers/scrapegraph_enricher.py`) is not a plain LiteLLM
  passthrough and rejects an `"openrouter/..."` model string outright; it goes in as a
  `langchain_openai.ChatOpenAI` model_instance pointed at OpenRouter's base_url instead.

Retry handling was also broken for a single-key setup: `maxAttempts = keys.length * 2` gave a
lone key only 2 attempts before giving up, and none of the adapters read the `Retry-After`
header, so retries guessed a flat 2s regardless of what the server actually asked for. Fixed:
`maxRetries` is now independent of pool size (default 5), and `parseRetryAfter()`
(`src/classification/providers/retryAfter.js`) is honoured everywhere.

### businesslist.pk / businesslist.com.ng — new Scrapy source, verified live

`scrapy-scraper/leadspiders/spiders/businesslist_pk.py` targets a general-business directory
platform, general local business (auto workshops, freight, clinics, salons) rather than the
software-agency directories the existing 14 sources saturate. **Multi-country in one spider**
(`-a country=pk|ng`) — confirmed live that `businesslist.com.ng` shares the exact page
structure. `businesslist.co.za` also exists but is WordPress, a different platform — not
supported, would need its own spider. Category slugs are checked against each site's real
`/browse-business-directory` page before being hardcoded — several guessed ones 404 (real
slugs are more specific than the obvious guess, e.g. `insurance-companies` not `insurance`).
Nigeria's `robots.txt` sets `Crawl-delay: 40` (25x Pakistan's default), honoured via
`DOWNLOAD_SLOTS` in `settings.py`.

`scripts/ingest-run-csv.js` is the **missing link** a spider's CSV needs — `output/runs/` is
write-only, nothing reads it back automatically (the old scaffold README claimed otherwise;
corrected). This script runs a spider's raw CSV through the real pipeline and syncs to
Supabase. It had its own silent bug: it called `runPipeline(raw, { config })` with no
`pythonBin`, so the ScrapegraphAI enrichment rung silently never ran for anything ingested
this way — fixed by extracting `resolvePythonBin()` (was private to `src/index.js`) into
`src/lib/pythonBin.js`.

**Crawl output resilience was learned the hard way, twice, against a real interruption:**
1. First version buffered scraped rows in memory, wrote the CSV only in `closed()`. An
   interrupted process lost an entire 457-lead crawl — nothing on disk, no error.
2. Switched to Scrapy's built-in `FEEDS` export (writes as items arrive, in theory). Tested it
   directly: scraped 20+ real items, killed the process both via `SIGKILL` and a plain
   `SIGTERM`. **Both left a 0-byte file** — on this stack (Git Bash on Windows) neither signal
   reliably triggers Scrapy's graceful-shutdown/flush path.
3. Real fix: `scrapy-scraper/leadspiders/pipelines.py`'s `FlushingCsvPipeline` — flushes to
   disk after every single row. Re-ran the identical kill test: 12 items scraped, hard-killed,
   all 12 survived. **If you ever touch spider output again, don't trust FEEDS on this stack —
   test against a real kill, don't assume.**

### Taxonomy 17 → 25 industries, and a real classifier bug the new source exposed

Added automotive, logistics-transport, manufacturing-industrial, real-estate,
finance-insurance, agriculture-food, media-entertainment, beauty-wellness. The first real
businesslist.pk crawl then exposed that `classifyLead` ran `matchTaxonomy` in **substring**
mode, not word-boundary mode (the guard already existed for exactly this — `webTagger.js` used
it, the main rules pass never did). 17% of a real 130-lead crawl was mis-tagged this way
("HairSense" → ai-ml via "h·ai·rsense", "Bigbasket.pk" → data-analytics-bi via "·bi·gbasket").
Fixing it naively broke plurals ("estate agent" vs directory category "estate agents") and
then broke acronyms (stripping a keyword's own trailing "s" turns "ios" into "io", which
matches any `.io` domain) — final rule tolerates a plural in the *text* only, never strips one
from the *keyword*. A **second** landmine (`"developers"` as a bare real-estate keyword,
matching "software developers" constantly) was caught by a dry-run before it ever hit
Supabase — `scripts/reclassify-supabase.js` (new, `--apply` required, dry-run by default,
skips `tag_source` web/llm as strictly-better signal) confirmed **0 CHANGED / 0 CLEARED
outstanding** after the real production reclassify ran. Also fixed while there: a duplicate
`dedupe_key` collision (24 rows, recomputed key collapses two stored keys to one) that can
poison an entire Supabase upsert batch — the reclassify script now collapses on the recomputed
key before syncing.

### Score floor: businesslist_pk/ng leads (phone+website, no reviews) scored ~18–23 against a
floor of 35 and were entirely discarded. `SOURCE_SCORES` gained `businesslist_pk`/`_ng: 10`
(matches `google_maps`) and the floor dropped to `config.json`'s `quality.minScore: 22` —
**deliberately decoupled** from the C/D tier boundary (still 35); see `filterByScore`'s header
comment before "fixing" that apparent mismatch.

### CI: new `scrapy-scrape.yml`, and a real cross-workflow bug found by actually triggering it

New third weekly workflow (Fridays) runs both countries, ingests, syncs, commits — same shape
as the other two. Manually triggering it (`gh workflow run scrapy-scrape.yml -f ...`) is what
caught two real bugs no local run would have: **all five workflows pinned Node 20**, but
`@supabase/supabase-js`'s realtime client needs native `WebSocket` (Node 22+) — every
`npm test` step was silently going to fail on its next scheduled run, not just this new
workflow's. Bumped to Node 24 everywhere. Second: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
weren't set as GitHub repo secrets at all — the sync step skipped cleanly, `export-all`
correctly refused to overwrite `all.csv` with empty data and failed loudly, nothing bad landed
on `main`. Both fixed; a scoped manual run (1 page/category) then **fully succeeded end to end
for the first time** — 5,132 leads synced, commit `fffda0d` landed. Repo secrets now set:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` (Groq/Mistral were already
present from an earlier session).

### Repo hygiene
`Scrapegraph-ai-main/` (385 files) and `Agent-Reach-main/` (117 files) — vendored upstream
copies, 54% of all tracked files, referenced by zero code (`scrapegraphai` comes from pip) —
untracked via `.gitignore` (stay on disk, stay in git history). Root-level stragglers moved:
`rescore.js` → `scripts/`, `leads.txt`/`agent-reach-txt.txt` → `docs/notes/`.

### Not done / open
- Only scoped sanity crawls have run against businesslist.pk/ng so far (a handful of
  categories, 1–2 pages). The real weekly Friday run uses fuller defaults (8 pages PK, the
  10-category thin-vertical set for NG) and hasn't fired yet.
- `CEREBRAS_API_KEY`/`GEMINI_API_KEY`/`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` aren't
  GitHub repo secrets yet — `llm-classification.yml` references them but they're inert in CI
  until added. Cloudflare is the *active* classification provider locally; it needs its two
  secrets added before the CI classify workflow can actually use it (it'll silently fall back
  to no-op otherwise, same pattern as every other unconfigured rung in this project).
- The dashboard's "Forgot password?" link points at `/reset-password`, which doesn't exist
  (404) — found, not fixed, user redirected focus elsewhere.
- Production Vercel deployment (`lead-scraper-mazestic.vercel.app`) is running with the no-auth
  local-dev mode live and public — flagged explicitly, user's call was "leave it open for now."
  Don't re-raise this unprompted; they know.
- `creds_2.txt` at repo root holds plaintext provider keys — correctly gitignored/untracked,
  but still plaintext on disk. Not this session's call to move it.

---

## Previous session: additive fallback rungs (Firecrawl, MarkItDown, curl-impersonate, Crawlee)

User pasted a folder of open-source scraping tools (`Scrapper_directories/`: crawlee, firecrawl,
curl-impersonate, markitdown, autoscraper, scrapy, scrcpy) and asked to integrate whatever's
useful **without replacing anything that already works**, and with a "fallback staircase" —
each new tool only activates when the existing rungs above it already failed/came up empty.

### What shipped (pushed to `origin/main`)

The codebase already had this exact pattern established (`emailFinder.js` → ScrapegraphAI
email enrichment, `jinaReader.js` → web tagging). This session added more rungs to those
same staircases, plus two standalone additions:

1. **Firecrawl — 3rd rung on email enrichment**, after `emailFinder.js` (rung 1) and
   ScrapegraphAI (rung 2). New: [src/lib/firecrawlEnricher.js](src/lib/firecrawlEnricher.js).
   Wired into `runPipeline.js` right after the ScrapegraphAI block. Fully opt-in — no-ops
   with a log line if `FIRECRAWL_API_KEY` isn't set. Config: `config.firecrawl`
   (`maxCallsPerRun: 100` to stay inside the free tier). Secret not yet added to GitHub —
   add `FIRECRAWL_API_KEY` there when/if you sign up for the free tier.

2. **MarkItDown — 2nd rung on web tagging**, after Jina Reader. New:
   [src/quality/markitdown_fetch.py](src/quality/markitdown_fetch.py) (same stdin/stdout JSON
   contract as `scrapling_fetch.py`) + [src/lib/markitdownReader.js](src/lib/markitdownReader.js)
   wrapper. Wired into `webTagger.js`'s `tagFromWebsite()` — only called when `readAsText`
   (Jina) returns null. `pythonBin` now threaded through `tagLeadsFromWeb` → `runPipeline.js`.
   CI installs `markitdown[all]` in `weekly-scrape.yml`.

3. **curl-impersonate — TLS-fingerprint fallback inside `emailFinder.js`**. New:
   [src/lib/curlImpersonate.js](src/lib/curlImpersonate.js). Wraps `fetchPage()`'s try/catch —
   if plain `fetch()` throws, retries once via the `curl_chrome116` binary before giving up.
   Self-probes for the binary and silently disables if absent (no binary on Windows dev by
   default). CI downloads a prebuilt Linux binary in `weekly-scrape.yml` as a
   `continue-on-error: true` step — a failed download never fails the run.

4. **Crawlee — new engine option, not wired into any existing scraper**. New:
   [src/engines/crawleeEngine.js](src/engines/crawleeEngine.js), exposing
   `fetchWithCrawlee(url)` (CheerioCrawler) and `fetchRenderedWithCrawlee(url)`
   (PlaywrightCrawler) as single-URL fetch calls matching the shape every existing scraper
   already uses — deliberately NOT the request-queue architecture Crawlee normally wants, so
   it can be adopted by a *new* scraper without anyone rewriting the pipeline. `cloakEngine.js`
   is untouched; this is available infrastructure for future directories, not a replacement.

5. **AutoScraper — dev-only utility**, never imported by the pipeline. New:
   [scripts/discover-scraper.py](scripts/discover-scraper.py) — give it a URL + sample value,
   it learns CSS selectors to speed up writing a *new* scraper by hand.

6. **Scrapy — scaffold only, no spiders**. User explicitly chose "scaffold, no spiders yet"
   over naming real target directories, to avoid re-scraping sources the Node.js scrapers
   already cover (pure duplicate-lead waste). See
   [scrapy-scraper/README.md](scrapy-scraper/README.md) for the plug-in contract (CSV in
   `output/runs/`, existing master-merge picks it up automatically) — don't write a spider
   here without a specific, unclaimed directory URL first.

7. **scrcpy** — Android screen-mirroring tool, genuinely unrelated to scraping. Ignored, no
   integration attempted.

### Verified
- `npm test`: 116/116 passing (was 111 before this session — 5 new tests in
  [test/fallbackRungs.test.js](test/fallbackRungs.test.js) proving every new rung is a
  true no-op — returns null/leaves leads untouched, never throws — when its prerequisite
  (API key / binary / pythonBin) is absent).
- `node --check` clean on every new/edited file.
- `node scripts/test-filters.js` (existing local pipeline smoke test) still produces the
  same shape of results as before — the curl-impersonate wrapper inside `emailFinder.js`
  doesn't change normal-path behavior.
- `crawlee` actually installed and fetch-tested live (`fetchWithCrawlee('https://example.com')`
  returned real HTML) — the only one of the four with no external key/binary dependency, so
  it's exercised for real rather than just proven to no-op.

### All 3 pipeline-touching workflows now have the same rungs (checked, not left partial)
`runPipeline.js` (and therefore the Firecrawl/MarkItDown/curl-impersonate rungs) runs from
three workflows: `weekly-scrape.yml`, `weekly-scrape-general.yml`, and
`personalized-scrape.yml` (via `runSavedSearches.js`). All three now install `markitdown[all]`,
attempt the curl-impersonate binary download, and pass `FIRECRAWL_API_KEY` through. The 4th
workflow, `llm-classification.yml`, does **not** call `runPipeline` (it only runs Layer-3
LLM classification on already-scraped Supabase rows via `runLlmClassification.js`) — verified
via grep before deciding it needed no changes, not assumed.

### Not done / needs a follow-up decision
- `FIRECRAWL_API_KEY` GitHub secret doesn't exist yet — the rung is wired but inert in CI
  until someone adds it, across all three workflows that now reference it.
- `curl-impersonate` install step in `weekly-scrape.yml` resolves the download URL live via
  the GitHub API (`repos/lwthiker/curl-impersonate/releases/latest`) rather than a hardcoded
  version, since the real repo/asset naming was verified during this session (it's
  `lwthiker/curl-impersonate`, not the first name guessed — corrected before commit). Still
  `continue-on-error: true`, so if GitHub's asset naming changes again it fails silently
  rather than breaking the run — check `curl_chrome116 --version` output in Action logs if
  you ever need to confirm whether this rung is actually active in CI.
- Scrapy has zero spiders — needs a real target directory named before it's anything more
  than a folder with a README.

---

## Earlier session: "no missing leads tolerated" + general local business expansion

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
- **Verify against the live API, not memory, before hardcoding a model name/id.** Every default
  model picked from memory this session (OpenRouter, Cerebras, Cloudflare) was wrong — free
  tiers rotate their model lists faster than training data reflects. Curl the real endpoint
  first.
- **Don't trust a resilience mechanism you haven't killed a process against.** Scrapy's FEEDS
  export looks correct in the docs and still lost everything on this Git-Bash-on-Windows stack
  under both SIGKILL and SIGTERM. If output-durability matters, test the actual failure mode,
  not the documented one.
- **`gh` CLI is authenticated and available** — used this session to trigger/monitor workflow
  runs (`gh workflow run`, `gh run view --log-failed`) and to set repo secrets
  (`gh secret set NAME`, reading the value from local `.env`/`creds_2.txt`). Setting a repo
  secret was treated as needing explicit user confirmation first (it's persistent account
  config) — asked, got a yes, then proceeded. Don't assume that carries forward to a different
  secret/action without asking again.
- User is comfortable with local credential files (`creds_2.txt`, `.env`) being read to
  populate GitHub secrets or test provider connections directly, as long as values aren't
  printed to output. Confirmed this session, not a one-off exception.

---

## Where to look for more

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — full architecture reference (schema, scoring
  formula, sources, personalized-leads worker design, dashboard API routes). Written for
  pasting into an external AI, more exhaustive but **increasingly stale** — still describes an
  earlier taxonomy count and doesn't know about businesslist.pk/ng, the 5-provider LLM stack,
  or `scrapy-scrape.yml`. Trust `knowledge.md` over it until someone refreshes it; the gap has
  widened across two sessions now, worth doing if anyone's about to rely on it heavily.
- [ROADMAP.md](ROADMAP.md), [SOURCES.md](SOURCES.md), [DEPLOYMENT.md](DEPLOYMENT.md),
  [README.md](README.md) — supplementary docs, not touched this session.
- Known gaps as of this session (from PROJECT_CONTEXT.md, still true): LLM classifier layer
  3 exists as infrastructure (`tag_source: 'llm'`) and was built in an earlier session — it
  runs via `node src/index.js classify`, check `src/jobs/runLlmClassification.js` if asked
  about it. The ICP filter still runs *before* classification, so a truly off-ICP lead is
  dropped before the web tagger could rescue it (unchanged, not addressed this session).
