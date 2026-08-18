"""Writes each scraped item to disk and flushes immediately, rather than
relying on Scrapy's built-in FEEDS export.

This replaced a FEEDS-based approach after directly testing it against process
interruption: FEEDS buffers rows until the exporter closes cleanly on spider
shutdown. Tested live on this environment with both SIGKILL and — expecting it
to behave differently — a plain SIGTERM. Both produced a 0-byte CSV despite
20+ items already having been scraped, because on Windows (this stack runs
under Git Bash on Windows) neither Python nor Twisted reliably intercepts a
process-kill signal to run its graceful-shutdown/flush path; the process just
stops. Any strategy that defers the actual disk write to a shutdown hook loses
data here — flush() after every single row, verified by the same kill test
afterward, is what survives it.

Why not fsync() too: flush() moves data from Python's buffer to the OS's, and
the OS buffer survives a killed PROCESS (what we're defending against — an
interrupted crawl) even though it would not survive a lost-power/OS crash.
fsync() defends against the latter at a real per-row cost across a
multi-thousand-item crawl and isn't the failure mode this project has actually
hit, so it's deliberately not used here.
"""
import csv
from datetime import datetime
from pathlib import Path

FIELDS = [
    "name", "category", "website", "phone", "address",
    "maps_url", "source", "engine", "search_query", "scraped_at",
]


class FlushingCsvPipeline:
    # from_crawler + self.crawler.spider (rather than a `spider` argument on
    # each hook) is Scrapy's current-generation pipeline API — the older
    # per-hook `spider` argument now logs a ScrapyDeprecationWarning on every
    # single run and will stop being passed at all in a future version.
    @classmethod
    def from_crawler(cls, crawler):
        pipeline = cls()
        pipeline.crawler = crawler
        return pipeline

    def open_spider(self):
        spider = self.crawler.spider
        out_dir = Path(__file__).resolve().parents[2] / "output" / "runs"
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        country = getattr(spider, "country", "unknown")
        self.path = out_dir / f"scrapy-businesslist-{country}-{stamp}.csv"
        self.fh = self.path.open("w", newline="", encoding="utf-8")
        self.writer = csv.DictWriter(self.fh, fieldnames=FIELDS)
        self.writer.writeheader()
        self.fh.flush()
        self.count = 0
        spider.logger.info("Streaming raw leads -> %s", self.path)

    def process_item(self, item):
        self.writer.writerow({k: item.get(k, "") for k in FIELDS})
        self.fh.flush()
        self.count += 1
        return item

    def close_spider(self):
        if not hasattr(self, "fh"):
            return
        self.fh.close()
        self.crawler.spider.logger.info(
            "Wrote %d raw lead(s) -> %s\n"
            "Next: node scripts/ingest-run-csv.js %s",
            self.count, self.path, self.path,
        )
