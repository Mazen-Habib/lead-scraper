"""Scrapy settings for the lead spiders.

Deliberately conservative: this crawls a small directory site that is doing us
a favour by being scrapeable at all, so the defaults here are politeness-first
(one request at a time per domain, autothrottle on, real delay between hits).
Speed is not the constraint — the weekly job has hours of budget.
"""

BOT_NAME = "leadspiders"

SPIDER_MODULES = ["leadspiders.spiders"]
NEWSPIDER_MODULE = "leadspiders.spiders"

ROBOTSTXT_OBEY = True

# Politeness. businesslist.pk is a small site; hammering it would be both rude
# and a fast way to get blocked. One concurrent request, ~1.5s apart, with
# autothrottle widening the gap if the server starts responding slowly.
CONCURRENT_REQUESTS = 4
CONCURRENT_REQUESTS_PER_DOMAIN = 1
DOWNLOAD_DELAY = 1.5
RANDOMIZE_DOWNLOAD_DELAY = True

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.5
AUTOTHROTTLE_MAX_DELAY = 30.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0

# Per-domain overrides. businesslist.com.ng's robots.txt declares
# "Crawl-delay: 40" (verified live) — 25x DOWNLOAD_DELAY's default. Scrapy's
# RobotsTxtMiddleware does NOT auto-apply a site's Crawl-delay; DOWNLOAD_SLOTS
# (Scrapy 2.11+) is the supported way to set it explicitly per domain without
# slowing every other spider/domain down to match.
DOWNLOAD_SLOTS = {
    "businesslist.com.ng": {"delay": 40, "concurrency": 1},
}

# Retry on the transient stuff, give up on the rest rather than looping.
RETRY_ENABLED = True
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 522, 524, 408, 429]

DOWNLOAD_TIMEOUT = 30

HTTPCACHE_ENABLED = False

# Item output: leadspiders/pipelines.py's FlushingCsvPipeline, NOT Scrapy's
# built-in FEEDS setting. This was learned the hard way across two escalating
# fixes, both against a real interrupted run:
#
#   1. First version buffered rows in memory and wrote the CSV only from a
#      `closed()` callback. An interrupted process lost the ENTIRE crawl —
#      457 scraped leads gone, nothing on disk, no error.
#   2. Switched to Scrapy's FEEDS export (writes as items arrive, in theory).
#      Tested directly against a live crawl with both SIGKILL and a plain
#      SIGTERM: BOTH left a 0-byte CSV despite 20+ items already scraped.
#      FEEDS still buffers until the exporter closes cleanly on spider
#      shutdown, and on this stack (Git Bash on Windows) neither signal
#      reliably triggers that clean shutdown — the process just stops.
#
# FlushingCsvPipeline calls flush() after every single row, verified by the
# same kill test to actually survive it. See that module's docstring for why
# flush() (not fsync()) is the right tradeoff for "interrupted process", which
# is the failure mode this project has actually hit — not "lost power".
ITEM_PIPELINES = {
    "leadspiders.pipelines.FlushingCsvPipeline": 300,
}

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
FEED_EXPORT_ENCODING = "utf-8"

LOG_LEVEL = "INFO"
