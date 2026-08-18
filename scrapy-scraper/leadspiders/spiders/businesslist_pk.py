"""businesslist.<tld> — general-business directories on a shared platform.

Why Scrapy for this one (per scrapy-scraper/README.md's criterion 2): each site
is a 300+ category directory paginated 20 listings to a page, with categories
running past 100 pages each. That's a deep multi-thousand-page crawl where
Scrapy's built-in pagination, retry and autothrottle machinery is genuinely
worth more than another hand-rolled fetch loop.

Why it isn't a duplicate: none of the 14 sources in src/sources/index.js cover
it, and its category tree is general local business (auto workshops, freight,
textile mills, estate agents, beauty salons) rather than the software-agency
directories clutch/goodFirms/sortlist/designRush/techBehemoths/selectedFirms
already saturate.

Multi-country: this same platform runs businesslist.pk (Pakistan) and
businesslist.com.ng (Nigeria) with an IDENTICAL page structure — confirmed live
(same /category/<slug>[/<page>] and /company/<id>/<slug> paths, same JSON-LD
block). businesslist.co.za exists too but is WordPress, a different platform
entirely — NOT supported here, would need its own spider.

Category slugs are NOT universal across countries (verified: "insurance" and
"manufacturing" 404 — the real slugs are "insurance-companies"/
"finances-insurance" and "manufacturing-industry"). DEFAULT_CATEGORIES below
was checked against both live category-browse pages before being written; a
category missing on one country's site 404s harmlessly (see on_error) rather
than crashing the crawl, but check before assuming a slug is universal.

Every company page carries a schema.org LocalBusiness JSON-LD block with name,
address, telephone and website, so extraction reads structured data first and
only falls back to CSS selectors if that block is missing or malformed.

Output: a CSV of RAW leads (internal field names, see src/lib/leadFields.js),
written to output/runs/ by leadspiders/pipelines.py's FlushingCsvPipeline,
which flushes to disk after EVERY row rather than buffering. That is a
deliberate, tested choice — see that module's docstring and settings.py's
ITEM_PIPELINES comment for why Scrapy's own FEEDS export was tried first and
did not survive an interrupted process on this stack. Output is deliberately
NOT a finished lead set — no ICP filter, classification, email enrichment,
scoring or dedupe has happened yet. Feed it through the real pipeline with:

    node scripts/ingest-run-csv.js output/runs/scrapy-businesslist-<ts>.csv

Usage:
    scrapy crawl businesslist_pk                          # Pakistan, default categories
    scrapy crawl businesslist_pk -a country=ng             # Nigeria, default categories
    scrapy crawl businesslist_pk -a categories=auto-repair,car-rental
    scrapy crawl businesslist_pk -a max_pages=5
"""

import json
import re
from datetime import datetime, timezone

import scrapy


# domain + robots.txt Crawl-delay (seconds), verified live per country:
#   pk: no Crawl-delay directive -> settings.py's DOWNLOAD_DELAY (1.5s) applies
#   ng: "Crawl-delay: 40" in robots.txt -> honoured via DOWNLOAD_SLOTS below
COUNTRIES = {
    "pk": {"domain": "www.businesslist.pk", "crawl_delay": None},
    "ng": {"domain": "businesslist.com.ng", "crawl_delay": 40},
}

# Verified against both countries' /browse-business-directory pages (categories
# are shared platform-wide, not per-country) before being committed here — a
# category picked by guessing the obvious slug (e.g. "insurance", "spas",
# "freight-forwarding") 404s, because the real slugs are more specific
# ("insurance-companies", "fitness", "package-shipping"). Chosen to cover the
# verticals genuinely thin in the current corpus: automotive, logistics-
# transport, manufacturing-industrial, real-estate, finance-insurance,
# healthcare, professional-services (legal), beauty-wellness.
DEFAULT_CATEGORIES = [
    # automotive
    "auto-repair", "auto-dealers-newused", "car-rental", "auto-parts-newused",
    "vehicle-manufacturers",
    # logistics-transport
    "logistics", "transport", "courier-services", "package-shipping",
    # manufacturing-industrial
    "manufacturing-industry", "textile", "food-manufacturing",
    "furniture-manufacturers", "industrial-equipment",
    # real-estate
    "estate-agents", "property-management", "realtors", "property-development",
    "construction-services",
    # finance-insurance
    "insurance-companies", "finances-insurance", "banks-credit-unions",
    "audit-and-accounting",
    # healthcare (genuinely thin in the corpus — 14 leads before this crawl)
    "doctors-and-clinics", "pharmacies", "wellness",
    # professional-services / legal (also thin — no dedicated source covers it)
    "lawyers", "legal-services",
    # media-entertainment
    "printing", "photography", "events-conferences",
    # beauty-wellness
    "beauty-professionals", "health-beauty", "fitness",
]


class BusinesslistPkSpider(scrapy.Spider):
    name = "businesslist_pk"

    def __init__(self, categories=None, max_pages=10, country="pk", *args, **kwargs):
        super().__init__(*args, **kwargs)
        if country not in COUNTRIES:
            raise ValueError(
                f"Unknown country '{country}'. Supported: {', '.join(COUNTRIES)}. "
                "businesslist.co.za exists but is a different platform (WordPress) "
                "and needs its own spider — see the module docstring."
            )
        self.country = country
        self.domain = COUNTRIES[country]["domain"]
        self.base = f"https://{self.domain}"
        self.allowed_domains = [self.domain]
        # scrapy.Spider reads `custom_settings` (a class-level dict) BEFORE
        # __init__ runs, so a per-instance value here cannot reach it — hence
        # DOWNLOAD_SLOTS in settings.py keyed by domain instead of trying to
        # set DOWNLOAD_DELAY per spider run.

        self.categories = (
            [c.strip() for c in categories.split(",") if c.strip()]
            if categories
            else list(DEFAULT_CATEGORIES)
        )
        self.max_pages = int(max_pages)

    # Scrapy 2.13+ deprecated the sync start_requests() in favour of an async
    # start() coroutine (start_requests() still works but logs a warning on
    # every run). requirements.txt pins scrapy>=2.15, so there is no older
    # version to stay compatible with — just the new form.
    async def start(self):
        for cat in self.categories:
            yield scrapy.Request(
                f"{self.base}/category/{cat}",
                callback=self.parse_category,
                cb_kwargs={"category": cat, "page": 1},
                # A category that doesn't exist 404s; that's information, not a
                # failure worth killing the crawl over.
                errback=self.on_error,
            )

    def parse_category(self, response, category, page):
        hrefs = set(response.css('a[href*="/company/"]::attr(href)').getall())
        for href in hrefs:
            if not re.search(r"/company/\d+/", href):
                continue
            yield response.follow(
                href,
                callback=self.parse_company,
                cb_kwargs={"category": category},
                errback=self.on_error,
            )

        if page < self.max_pages and hrefs:
            yield scrapy.Request(
                f"{self.base}/category/{category}/{page + 1}",
                callback=self.parse_category,
                cb_kwargs={"category": category, "page": page + 1},
                errback=self.on_error,
            )

    def parse_company(self, response, category):
        data = self._json_ld(response)

        name = data.get("name") or response.css("#company_name::text").get("")
        name = (name or "").strip()
        if not name:
            return  # nothing usable without a company name

        phone = (data.get("telephone") or "").strip()
        if not phone:
            phone = (response.css(".text.phone::text").get("") or "").strip()

        website = (data.get("url") or "").strip()
        # The directory's own URL is not the company's website.
        if self.domain in website:
            website = ""

        address = self._address(data) or (
            response.css("#company_address::text").get("") or ""
        ).strip()

        row = {
            "name": name,
            "category": category.replace("-", " "),
            "website": website,
            "phone": phone,
            "address": address,
            "maps_url": response.url,
            "source": f"businesslist_{self.country}",
            "engine": "scrapy",
            "search_query": category,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }
        # leadspiders/pipelines.py's FlushingCsvPipeline writes and flushes
        # this to disk immediately — no in-memory buffer, no write-once-at-
        # the-end. See that module's docstring for why.
        yield row

    @staticmethod
    def _json_ld(response):
        for block in response.css('script[type="application/ld+json"]::text').getall():
            try:
                parsed = json.loads(block.strip())
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, list):
                parsed = next(
                    (p for p in parsed if isinstance(p, dict) and "name" in p), {}
                )
            if isinstance(parsed, dict) and parsed.get("name"):
                return parsed
        return {}

    @staticmethod
    def _address(data):
        addr = data.get("address")
        if not isinstance(addr, dict):
            return ""
        parts = [
            addr.get("streetAddress"),
            addr.get("addressLocality"),
            addr.get("addressRegion"),
        ]
        return ", ".join(p for p in parts if p)

    def on_error(self, failure):
        self.logger.warning("Request failed: %s", failure.value)
