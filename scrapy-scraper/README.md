# Scrapy spiders

## Active: `businesslist_pk` (Pakistan + Nigeria)

```bash
pip install -r requirements.txt
cd scrapy-scraper
scrapy crawl businesslist_pk                              # Pakistan (default), curated categories
scrapy crawl businesslist_pk -a country=ng                 # Nigeria, same spider
scrapy crawl businesslist_pk -a categories=auto-repair,car-rental
scrapy crawl businesslist_pk -a max_pages=5
```

Targets the `businesslist.<tld>` platform — general-business directories,
20 listings per page, categories running past 100 pages. Chosen because none
of the 14 sources in `src/sources/index.js` cover it and its category tree is
general local business (auto workshops, freight, textile mills, estate agents,
salons, doctors' clinics) rather than the software-agency directories
`clutch`/`goodFirms`/`sortlist`/`designRush`/`techBehemoths`/`selectedFirms`
already saturate. Every company page carries a schema.org `LocalBusiness`
JSON-LD block with name, address, telephone and website.

**Multi-country, one spider.** `-a country=pk` (default) or `-a country=ng`
select between `businesslist.pk` and `businesslist.com.ng` — confirmed live to
share an identical page structure (`/category/<slug>[/<page>]`,
`/company/<id>/<slug>`, same JSON-LD shape). `businesslist.co.za` also exists
but is WordPress, a genuinely different platform — **not** supported here, it
would need its own spider.

Category slugs are **not** interchangeable across countries by assumption —
verified against both sites' `/browse-business-directory` pages before being
hardcoded (`"insurance"` and `"manufacturing"` both 404; the real slugs are
`insurance-companies`/`finances-insurance` and `manufacturing-industry`). If
you add a category, check it resolves on the actual site first — a category
that doesn't exist for a given country 404s harmlessly rather than crashing
the crawl, so a typo won't fail loudly.

**Crawl-delay differs by country.** `businesslist.pk`'s `robots.txt` sets none
(the ~1.5s `DOWNLOAD_DELAY` in `settings.py` applies). `businesslist.com.ng`
declares `Crawl-delay: 40` — 25x slower — honoured via `DOWNLOAD_SLOTS` in
`settings.py` rather than slowing every domain down to match. Scope Nigeria
runs accordingly: a handful of categories at `max_pages=1` already takes over
an hour.

`robots.txt` allows `/company/` and `/category/` on both sites (blocks only
admin, user and search endpoints). `ROBOTSTXT_OBEY = True`.

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

## CI

`.github/workflows/scrapy-scrape.yml` runs both countries weekly (Fridays,
offset from the Sunday tech run and Wednesday general run), ingests every
`output/runs/scrapy-businesslist-*.csv` through `scripts/ingest-run-csv.js` in
one call, and commits/pushes the result — same shape as the other two weekly
workflows. `workflow_dispatch` inputs let you widen `max_pages` or Nigeria's
category list for a one-off deeper run without editing the file.
