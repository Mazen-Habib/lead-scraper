# Scrapy scaffold — not active yet

This is infrastructure only. There are **no spiders here yet** — adding one
without a specific, unclaimed target directory would just re-scrape sites our
Node.js scrapers already cover (`config.json`), producing pure duplicates that
`dedupe()` in `src/pipeline/runPipeline.js` throws away. That's wasted CI
minutes for zero new leads.

## When to use this

Add a spider here when you have a **specific directory URL** that:
1. Isn't already listed in `config.json` (check `clutch`, `goodFirms`,
   `sortlist`, `designRush`, `techBehemoths`, `selectedFirms`, etc. first)
2. Is genuinely easier to scrape with Scrapy than with our existing
   `normal_scraper` (plain fetch) / `cloak_browser` (Playwright stealth) engines
   — e.g. it has a Python-ecosystem-only client library, or needs Scrapy's
   built-in pagination/retry machinery for a deep multi-thousand-page crawl.

## How it plugs into the existing pipeline

1. Write a spider in `spiders/` that outputs a CSV matching our lead schema —
   see `src/lib/leadFields.js` for the canonical column list
   (`company_name, category, website, email, phone, address, ...`).
2. Have the spider write its output CSV to `output/runs/` using the same
   naming convention as `runTimestamp()` in `src/index.js`
   (`leads-YYYY-MM-DD-HHMM.csv`).
3. `src/index.js`'s master merge already reads every CSV in `output/runs/` and
   folds it into `output/leads-master.csv` — a Scrapy-produced CSV needs no
   special handling once it's in that directory with the right columns.

## Setup (once a real spider exists)

```bash
pip install scrapy
cd scrapy-scraper
scrapy crawl <spider_name>
```

A `.github/workflows/scrapy-scrape.yml` should be added at that point to run
it as its own parallel job — see `weekly-scrape-general.yml` for the pattern
(separate job, own timeout budget, commits back to `output/`).
