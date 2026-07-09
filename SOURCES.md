# Multi-Source Lead Strategy

How this pipeline fetches tech-industry leads from **every capable free source**, using
**two engines** — our own normal scrapers and the CloakBrowser stealth engine — with full
provenance tracking so you always know where each lead came from and how it was fetched.

## The two engines

| Engine | Column value | What it is | Used for |
|---|---|---|---|
| **Normal scraper** | `normal_scraper` | Our own Playwright browser + plain HTTP calls | Sources with no/weak anti-bot |
| **CloakBrowser** | `cloak_browser` | Stealth Chromium (C++-patched fingerprints, `humanize`) | Cloudflare/anti-bot-protected directories |

**Why two engines?** Our normal Playwright scraper gets a `403 Forbidden` on Cloudflare-
protected directories like Clutch and GoodFirms (verified — even `patchright` stealth fails
on them). CloakBrowser's source-level-patched Chromium gets `HTTP 200` on those same sites,
unlocking richer B2B firmographic data (company size, hourly rate, review counts) that
Google Maps doesn't expose. We use the lighter normal engine wherever it works and only
spend the heavier cloak engine on sites that require it.

## Provenance columns (every lead is marked)

Two columns record where each lead came from:

- **`source`** — the data source: `google_maps`, `openstreetmap`, `clutch`, `goodfirms`
- **`engine`** — the tool that fetched it: `normal_scraper` or `cloak_browser`

So you can always filter e.g. "show me only cloak_browser leads" or "only Clutch leads",
and score sources differently based on data quality.

## Sources

### Live (wired in and verified)

| Source | Engine | Data it gives | Website coverage | Status |
|---|---|---|---|---|
| **Google Maps** | normal | name, category, website, phone, address, rating, reviews | ~97% | ✅ workhorse — best phone coverage |
| **OpenStreetMap** (Overpass API) | normal | name, category, website, phone, sometimes email/socials | varies | ✅ great in US/EU, sparse in Pakistan |
| **Clutch.co** | cloak | name, website, location, rating, **reviews, company size, hourly rate, min project** | ~50% | ✅ richest firmographics |
| **GoodFirms** | cloak | name, **website (100%)**, location, rating, reviews | ~100% | ✅ best website coverage → best email enrichment |

### Evaluated but not wired

| Source | Why not |
|---|---|
| **YellowPages** | Even CloakBrowser gets `403` headless — needs a residential proxy. Add a proxy in config to enable. |
| **LinkedIn** | ToS ban risk + aggressive detection. Not worth it; use consented data instead. |
| **Crunchbase** | Login-walled for useful data. Candidate for cloak + proxy later. |
| **Paid APIs** (Apollo, Hunter) | Not free. See [RESEARCH.md](RESEARCH.md) for the paid path if you outgrow free sources. |

## Pipeline flow

```
config.json (sources + engines)
   │
   ├── NORMAL ENGINE
   │     ├── Google Maps      (Playwright)      → engine=normal_scraper
   │     └── OpenStreetMap    (HTTP/Overpass)   → engine=normal_scraper
   │
   ├── CLOAK ENGINE (CloakBrowser stealth Chromium)
   │     ├── Clutch.co        → engine=cloak_browser
   │     └── GoodFirms        → engine=cloak_browser
   │
   ▼
Dedupe across ALL sources (by website, then name)
   │
   ▼
Website enrichment (normal HTTP) — emails, LinkedIn, Facebook, Instagram
   │
   ▼
output/leads.csv   (source + engine columns mark every row)
```

Enrichment runs on all sources uniformly — any lead that has a website gets crawled for
contact info regardless of which engine found it.

## Full CSV schema

```
company_name, category, website, email, all_emails, phone, address,
linkedin, facebook, instagram, rating, review_count,
company_size, hourly_rate, min_project,        <- firmographics (mainly Clutch/GoodFirms)
search_query, profile_url,
source, engine,                                 <- PROVENANCE
scraped_at
```

## Configuring sources

Each source is a block in [config.json](config.json) with `enabled` and its own params.
Engines are intrinsic (Google/OSM = normal, Clutch/GoodFirms = cloak). The `cloak` block
configures the stealth engine shared by all cloak sources:

```json
"cloak": {
  "headless": true,
  "humanize": true,
  "proxy": ""          // add "http://user:pass@residential-proxy:port" to unlock harder sites
}
```

**Directory slugs** (the `directories` arrays) are geography/service specific:
- Clutch: `pk/developers`, `pk/web-developers`, `ae/developers`, `us/developers/mobile-app`, …
- GoodFirms: `directory/country/top-software-development-companies/pakistan`
  (uses the **full country name**, not the 2-letter code)

## Adding a new source

1. Write `src/scrapers/<name>.js` exporting an async function that returns leads in the
   common shape (`name, category, website, email, phone, address, rating, reviews,
   company_size, hourly_rate, min_project, maps_url`).
2. If the site is Cloudflare-protected, import `openCloakPage` from
   `src/engines/cloakEngine.js` (cloak engine). Otherwise use Playwright/`fetch` (normal).
3. Register it in `src/index.js` with a `tag(leads, { source, engine, query })` call so the
   `source` and `engine` columns are stamped.

## Scaling & proxies

- **CloakBrowser free binary is Chromium 146** and goes stale against evolving anti-bot
  systems within weeks. If Clutch/GoodFirms start blocking, either add a residential
  proxy (`cloak.proxy`) or move to CloakBrowser Pro (latest binary).
- Harder targets (YellowPages, DataDome-protected sites) need `proxy` + `headless:false`.
  The config supports `proxy` today; flip `headless` in the `cloak` block when needed.

## Compliance

Same rules apply to all sources — cold-outreach compliance (CAN-SPAM / GDPR legitimate
interest) is covered in [RESEARCH.md](RESEARCH.md). The `source` column gives you a data
provenance audit trail per lead, which matters for GDPR.
