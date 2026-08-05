# Free Lead Scraper (Node.js)

Scrapes tech-industry business leads from **eleven free sources** (plus one opt-in API) via
**two engines** — our own normal scrapers and the CloakBrowser stealth engine — then crawls
each company's website for **emails and social links**, verifies email domains are actually
mail-capable (free MX/DNS check), and filters out off-ICP or contact-less leads before
anything hits the CSV. Every lead is marked with its `source` and `engine`. No API keys, no
paid services required.

> Full strategy, engine rationale, quality/dead-email filtering, and how to add sources:
> **[SOURCES.md](SOURCES.md)**.

## Sources & engines

| Source | Engine | What it gives |
|---|---|---|
| **Google Maps** | `normal_scraper` | name, category, website, phone, address, rating, reviews |
| **OpenStreetMap** (Overpass) | `normal_scraper` | name, category, website, phone, sometimes email |
| **Clutch.co** | `cloak_browser` | name, website, location, rating, reviews, **company size, hourly rate, min project** |
| **GoodFirms** | `cloak_browser` | name, **website (~100%)**, location, rating, reviews |
| **GitHub Organizations** (API) | `normal_scraper` | name, website, email, bio, repo count |
| **PSEB / TechDestination** | `normal_scraper` | name, category, website or LinkedIn, location |
| **TopDevelopers.co** | `normal_scraper` | name, website, rating, reviews, company size, hourly rate, min project |
| **Sortlist** | `cloak_browser` | name, website, reviews count, team size |
| **Eventbrite** | `normal_scraper` | organizer name, website, socials, event venue |
| **DesignRush** | `cloak_browser` | name, website, rating, reviews, top service category |
| **OpenCorporates** (API, opt-in) | `normal_scraper` | name, company type, address — needs your own `apiToken` |

**Two engines:** our normal Playwright/`fetch` scraper gets `403` on Cloudflare-protected
directories (Clutch, GoodFirms, Sortlist, DesignRush) — even `patchright` fails, and in
Sortlist's case even plain Node `fetch` gets TLS-fingerprinted and blocked while `curl` on
the identical URL succeeds. [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) (stealth
Chromium with C++-patched fingerprints) passes them, unlocking richer firmographic data.
Each lead's `engine` column records which tool fetched it.

Several other sources were evaluated and found not viable (YellowPages, Upwork, Fiverr,
PeoplePerHour, Crunchbase, G2, Product Hunt, Rozee.pk, and more) — see the "Evaluated, not
viable" table in [SOURCES.md](SOURCES.md) for why each was ruled out rather than shipped
as a non-functional scraper.

## How it works

```
config.json (sources + engines)
   │
   ├── NORMAL:  Google Maps, OpenStreetMap, GitHub Orgs, OpenCorporates,
   │            PSEB, TopDevelopers, Eventbrite
   └── CLOAK:   Clutch, GoodFirms, Sortlist, DesignRush (CloakBrowser stealth Chromium)
   │
   ▼
Dedupe across ALL sources (normalized website/name key)
   │
   ▼
ICP/category filter
   │
   ▼
Website crawler (fetch + Cheerio) ── emails, LinkedIn, Facebook, Instagram
   │
   ▼
MX-based email verification (free DNS check, no API key)
   │
   ▼
Contact-point filter (drops leads with no phone/LinkedIn/reachable email)
   │
   ▼
output/runs/leads-<timestamp>.csv (per run) + output/leads-master.csv (cumulative)
```

## Usage

1. **Edit [config.json](config.json)** — set your target searches and cities:
   ```json
   {
     "googleMaps": {
       "enabled": true,
       "searches": [
         "software companies in <YOUR CITY>",
         "IT services companies in <YOUR CITY>",
         "web development agencies in <YOUR CITY>"
       ],
       "maxResultsPerSearch": 40,
       "headless": true
     },
     "openStreetMap": {
       "enabled": true,
       "cities": ["<YOUR CITY>"]
     },
     "clutch": {
       "enabled": true,
       "directories": ["pk/developers", "ae/developers"],
       "maxPages": 2
     },
     "goodFirms": {
       "enabled": true,
       "directories": ["directory/country/top-software-development-companies/pakistan"],
       "maxPages": 2
     },
     "cloak": { "headless": true, "humanize": true, "proxy": "" },
     "qualityFilter": { "categoryKeywords": ["software", "technology", "..."] },
     "findEmails": true
   }
   ```
   - OSM `cities` must be real place names (resolved to map areas).
   - Clutch slugs: `pk/developers`, `ae/developers`, `us/developers/mobile-app`, …
   - GoodFirms uses the **full country name** (`.../pakistan`, not `/pk`).
   - Sortlist/DesignRush use `categories` (e.g. `software-development`); GitHub Orgs uses
     `locations` (free-text); Eventbrite uses `searches: [{ query, location }]`.
   - `qualityFilter.categoryKeywords` controls the ICP filter — leads whose category/name
     doesn't match any keyword are dropped before enrichment.
   - `openCorporates` is disabled by default — set `apiToken` and `enabled: true` to use it.
   - See [SOURCES.md](SOURCES.md) for the full source/engine reference and why some
     evaluated sources (Upwork, Fiverr, YellowPages, Crunchbase, G2, …) aren't wired in.
2. **Run:**
   ```
   npm run scrape
   ```
3. Results land in `output/runs/leads-<timestamp>.csv` for that run, and `output/leads-master.csv`
   for the deduped, cumulative set across all runs.

Set `"headless": false` to watch the browser work (useful for debugging).

## CSV columns

`company_name, category, website, email, all_emails, phone, address, linkedin,
facebook, instagram, rating, review_count, company_size, hourly_rate, min_project,
search_query, profile_url, source, engine, email_verified, scraped_at`

**Provenance:** `source` = data source (`google_maps`, `openstreetmap`, `clutch`,
`goodfirms`, `github_orgs`, `pseb`, `topdevelopers`, `sortlist`, `eventbrite`,
`designrush`, `opencorporates`); `engine` = tool that fetched it (`normal_scraper` or
`cloak_browser`).

**Quality:** every row that reaches the CSV already passed the ICP/category filter and the
contact-point filter (see [SOURCES.md](SOURCES.md)). `email_verified` records the free
MX/DNS check on the email's domain: `alive`, `dead`, or `unknown` (DNS hiccup — not treated
as dead so a flaky lookup never wrongly drops a good lead).

Columns useful for scoring: `category` (industry fit), `rating` / `review_count`
(maturity), `company_size` / `hourly_rate` (firm profile, from Clutch/GoodFirms/TopDevelopers),
`email` + `email_verified=alive` (reachability), `linkedin` present (B2B presence).

## Notes & limits

- **Google Maps ~120 results cap per query.** Get more leads by splitting queries into
  neighborhoods/nearby cities or more specific keywords, not by raising `maxResultsPerSearch`.
- **Be gentle:** the scraper visits pages sequentially with delays. Running enormous
  batches back-to-back can trigger Google's rate limiting (CAPTCHA). If that happens,
  wait a while or set `headless: false` and solve it once.
- **Selectors can break** when Google changes its Maps DOM. If a run returns 0 results,
  the selectors in `src/scrapers/googleMaps.js` are the first place to look.
- Emails found are mostly generic (info@, hello@, sales@). For named decision-makers,
  enrich your top-scoring companies with Hunter.io (free 25 searches/month).
- **OneDrive lock (EBUSY):** this project lives in a OneDrive-synced folder, which can
  lock `leads.csv` while syncing or if it's open in Excel. The writer retries with
  backoff and, if still locked, saves to a timestamped `leads-<timestamp>.csv` so data
  is never lost. **Close the CSV in Excel before re-running** to avoid this.
- Outreach compliance (CAN-SPAM/GDPR) notes are in [RESEARCH.md](RESEARCH.md).
