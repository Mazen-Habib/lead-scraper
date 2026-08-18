"""businesslist.pk — Pakistan general-business directory.

Why Scrapy for this one (per scrapy-scraper/README.md's criterion 2): the site
is a 388-category directory paginated 20 listings to a page, with categories
running past 100 pages each. That's a deep multi-thousand-page crawl where
Scrapy's built-in pagination, retry and autothrottle machinery is genuinely
worth more than another hand-rolled fetch loop.

Why it isn't a duplicate: none of the 14 sources in src/sources/index.js cover
it, and its category tree is general local business (auto workshops, freight,
textile mills, estate agents, beauty salons) rather than the software-agency
directories clutch/goodFirms/sortlist/designRush/techBehemoths/selectedFirms
already saturate.

Every company page carries a schema.org LocalBusiness JSON-LD block with name,
address, telephone and website, so extraction reads structured data first and
only falls back to CSS selectors if that block is missing or malformed.

Output: a CSV of RAW leads (internal field names, see src/lib/leadFields.js).
It is deliberately NOT a finished lead set — no ICP filter, classification,
email enrichment, scoring or dedupe has happened yet. Feed it through the real
pipeline with:

    node scripts/ingest-run-csv.js output/runs/scrapy-businesslist-<ts>.csv

Usage:
    scrapy crawl businesslist_pk                      # default category set
    scrapy crawl businesslist_pk -a categories=auto-repair,car-rental
    scrapy crawl businesslist_pk -a max_pages=5
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import scrapy


# Default crawl set: categories chosen to exercise the verticals the taxonomy
# gained (automotive, logistics-transport, manufacturing-industrial,
# real-estate, finance-insurance, agriculture-food, media-entertainment,
# beauty-wellness) rather than re-covering the tech ground existing sources
# already hold. Override with -a categories=...
DEFAULT_CATEGORIES = [
    # automotive
    "auto-repair", "auto-dealers-newused", "car-rental", "auto-parts-newused",
    # logistics-transport
    "freight-forwarding", "courier-services", "logistics", "transport",
    # manufacturing-industrial
    "manufacturing", "textiles", "industrial-equipment", "packaging",
    # real-estate
    "estate-agents", "property-management", "construction-services",
    # finance-insurance
    "insurance", "banks-credit-unions", "audit-and-accounting",
    # agriculture-food
    "agriculture", "food-and-beverage", "poultry",
    # media-entertainment
    "printing-services", "photography", "event-management",
    # beauty-wellness
    "beauty-professionals", "gyms-and-fitness", "spas",
]

BASE = "https://www.businesslist.pk"


class BusinesslistPkSpider(scrapy.Spider):
    name = "businesslist_pk"
    allowed_domains = ["businesslist.pk"]

    def __init__(self, categories=None, max_pages=10, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.categories = (
            [c.strip() for c in categories.split(",") if c.strip()]
            if categories
            else list(DEFAULT_CATEGORIES)
        )
        self.max_pages = int(max_pages)
        self._rows = []

    def start_requests(self):
        for cat in self.categories:
            yield scrapy.Request(
                f"{BASE}/category/{cat}",
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
                f"{BASE}/category/{category}/{page + 1}",
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
        if "businesslist.pk" in website:
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
            "source": "businesslist_pk",
            "engine": "scrapy",
            "search_query": category,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }
        self._rows.append(row)
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

    def closed(self, reason):
        """Write the canonical CSV the ingest script expects."""
        if not self._rows:
            self.logger.warning("No rows scraped — not writing an empty CSV.")
            return

        root = Path(__file__).resolve().parents[3]
        out_dir = root / "output" / "runs"
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        out_file = out_dir / f"scrapy-businesslist-{stamp}.csv"

        import csv

        columns = [
            "name", "category", "website", "phone", "address",
            "maps_url", "source", "engine", "search_query", "scraped_at",
        ]
        with out_file.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=columns)
            writer.writeheader()
            writer.writerows(self._rows)

        self.logger.info(
            "Wrote %d raw leads -> %s\n"
            "Next: node scripts/ingest-run-csv.js %s",
            len(self._rows), out_file, out_file,
        )

    def on_error(self, failure):
        self.logger.warning("Request failed: %s", failure.value)
