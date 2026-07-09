# Free Lead Scraper (Node.js)

Scrapes tech-industry business leads from **two free sources** — Google Maps and
OpenStreetMap — then crawls each company's website to extract **emails and social
links**. Outputs a scoring-ready CSV. No API keys, no paid services.

## Sources

| Source | What it gives | How | Anti-bot? |
|---|---|---|---|
| **Google Maps** | name, category, website, phone, address, rating, reviews | Playwright browser | scroll/pacing to avoid CAPTCHA |
| **OpenStreetMap** (Overpass API) | name, category, website, phone, sometimes email + socials | plain HTTP JSON, no browser | none — fully open data |

Both feed the same pipeline and are deduped together. Enable/disable each in
[config.json](config.json).

> Note on other directories: YellowPages, Clutch, Yelp etc. are all behind
> Cloudflare/DataDome and return 403 even with stealth browsers (Patchright was tested).
> OpenStreetMap was chosen because it's the one high-quality source that's genuinely
> open. `patchright` is installed if you later want to attempt a protected site.

## How it works

```
config.json (searches + cities)
   │
   ├── Google Maps scraper (Playwright)
   └── OpenStreetMap scraper (Overpass API, with mirror failover)
   │
   ▼
Dedupe (by website/name across both sources)
   │
   ▼
Website crawler (fetch + Cheerio) ── emails, LinkedIn, Facebook, Instagram
   │
   ▼
output/leads.csv
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
     "findEmails": true,
     "outputFile": "output/leads.csv"
   }
   ```
   The OSM `cities` must be real place names (it resolves them to map areas).
2. **Run:**
   ```
   npm run scrape
   ```
3. Results land in `output/leads.csv`.

Set `"headless": false` to watch the browser work (useful for debugging).

## CSV columns

`company_name, category, website, email, all_emails, phone, address, linkedin,
facebook, instagram, google_rating, review_count, search_query, maps_url, source, scraped_at`

Columns useful for scoring: `category` (industry fit), `google_rating` / `review_count`
(business maturity), `email` present (reachability), `linkedin` present (B2B presence),
`website` present (digital maturity).

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
