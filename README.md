# Free Lead Scraper (Node.js)

Scrapes tech-industry business leads from **four free sources** via **two engines** — our
own normal scrapers and the CloakBrowser stealth engine — then crawls each company's website
for **emails and social links**. Every lead is marked with its `source` and `engine`.
Outputs a scoring-ready CSV. No API keys, no paid services.

> Full strategy, engine rationale, and how to add sources: **[SOURCES.md](SOURCES.md)**.

## Sources & engines

| Source | Engine | What it gives | Anti-bot? |
|---|---|---|---|
| **Google Maps** | `normal_scraper` | name, category, website, phone, address, rating, reviews | scroll/pacing |
| **OpenStreetMap** (Overpass) | `normal_scraper` | name, category, website, phone, sometimes email | none — open data |
| **Clutch.co** | `cloak_browser` | name, website, location, rating, reviews, **company size, hourly rate, min project** | Cloudflare (CloakBrowser passes) |
| **GoodFirms** | `cloak_browser` | name, **website (~100%)**, location, rating, reviews | Cloudflare (CloakBrowser passes) |

**Two engines:** our normal Playwright scraper gets `403` on Cloudflare-protected directories
(Clutch, GoodFirms) — even `patchright` fails. [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)
(stealth Chromium with C++-patched fingerprints) passes them, unlocking richer firmographic
data. Each lead's `engine` column records which tool fetched it. YellowPages still needs a
residential proxy even with CloakBrowser — add one in `config.cloak.proxy` to enable harder sites.

## How it works

```
config.json (sources + engines)
   │
   ├── NORMAL:  Google Maps (Playwright) + OpenStreetMap (HTTP)
   └── CLOAK:   Clutch + GoodFirms (CloakBrowser stealth Chromium)
   │
   ▼
Dedupe across ALL sources (by website/name)
   │
   ▼
Website crawler (fetch + Cheerio) ── emails, LinkedIn, Facebook, Instagram
   │
   ▼
output/leads.csv   (source + engine columns mark every row)
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
     "findEmails": true,
     "outputFile": "output/leads.csv"
   }
   ```
   - OSM `cities` must be real place names (resolved to map areas).
   - Clutch slugs: `pk/developers`, `ae/developers`, `us/developers/mobile-app`, …
   - GoodFirms uses the **full country name** (`.../pakistan`, not `/pk`).
   - See [SOURCES.md](SOURCES.md) for the full source/engine reference.
2. **Run:**
   ```
   npm run scrape
   ```
3. Results land in `output/leads.csv`.

Set `"headless": false` to watch the browser work (useful for debugging).

## CSV columns

`company_name, category, website, email, all_emails, phone, address, linkedin,
facebook, instagram, rating, review_count, company_size, hourly_rate, min_project,
search_query, profile_url, source, engine, scraped_at`

**Provenance:** `source` = data source (`google_maps`, `openstreetmap`, `clutch`,
`goodfirms`); `engine` = tool that fetched it (`normal_scraper` or `cloak_browser`).

Columns useful for scoring: `category` (industry fit), `rating` / `review_count`
(maturity), `company_size` / `hourly_rate` (firm profile, from Clutch/GoodFirms),
`email` present (reachability), `linkedin` present (B2B presence).

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
