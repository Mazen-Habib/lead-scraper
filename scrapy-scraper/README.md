# Scrapy spiders

## Active: `businesslist_pk`

```bash
pip install scrapy
cd scrapy-scraper
scrapy crawl businesslist_pk                       # default category set
scrapy crawl businesslist_pk -a categories=auto-repair,car-rental
scrapy crawl businesslist_pk -a max_pages=5
```

Targets [businesslist.pk](https://www.businesslist.pk) — a 388-category
Pakistan general-business directory, 20 listings per page, categories running
past 100 pages. Chosen because none of the 14 sources in `src/sources/index.js`
cover it and its category tree is general local business (auto workshops,
freight, textile mills, estate agents, salons) rather than the software-agency
directories `clutch`/`goodFirms`/`sortlist`/`designRush`/`techBehemoths`/
`selectedFirms` already saturate. Every company page carries a schema.org
`LocalBusiness` JSON-LD block with name, address, telephone and website.

`robots.txt` allows `/company/` and `/category/` (it blocks only admin, user
and search endpoints). `ROBOTSTXT_OBEY = True` and the crawl is throttled to
one concurrent request per domain — keep it that way.

## Adding another spider

Adding one without a specific, unclaimed target directory would just re-scrape
sites our Node.js scrapers already cover (`config.json`), producing pure
duplicates that `dedupe()` in `src/pipeline/runPipeline.js` throws away. That's
wasted CI minutes for zero new leads.

## When to use this

Add a spider here when you have a **specific directory URL** that:
1. Isn't already listed in `config.json` (check `clutch`, `goodFirms`,
   `sortlist`, `designRush`, `techBehemoths`, `selectedFirms`, etc. first)
2. Is genuinely easier to scrape with Scrapy than with our existing
   `normal_scraper` (plain fetch) / `cloak_browser` (Playwright stealth) engines
   — e.g. it has a Python-ecosystem-only client library, or needs Scrapy's
   built-in pagination/retry machinery for a deep multi-thousand-page crawl.

## How it plugs into the existing pipeline

1. Write a spider in `leadspiders/spiders/` that outputs a CSV of **raw** leads
   using the internal field names in `src/lib/leadFields.js` (`name`,
   `category`, `website`, `phone`, `address`, `maps_url`, `source`, ...).
2. Have the spider write that CSV to `output/runs/`.
3. Feed it through the real quality pipeline:

   ```bash
   node scripts/ingest-run-csv.js output/runs/<file>.csv
   ```

> **Correction (was wrong in an earlier revision of this file):** `src/index.js`'s
> master merge does **not** read CSVs from `output/runs/`. That directory is
> write-only — `src/index.js` drops run files there, but the master merge sources
> its existing set from Supabase (or `output/master.json` as a dev fallback).
> A spider's CSV left in `output/runs/` is inert. `scripts/ingest-run-csv.js`
> is the path that actually applies ICP filtering, email enrichment, MX verify,
> classification, scoring and the Supabase sync. Don't use
> `scripts/backfill-supabase.js` for spider output — that's a recovery tool for
> already-finished leads and would push unqualified, unclassified rows straight
> into the table the dashboard reads.

## Setup (once a real spider exists)

```bash
pip install scrapy
cd scrapy-scraper
scrapy crawl <spider_name>
```

A `.github/workflows/scrapy-scrape.yml` should be added at that point to run
it as its own parallel job — see `weekly-scrape-general.yml` for the pattern
(separate job, own timeout budget, commits back to `output/`).
