/**
 * Overture Maps Places — worldwide, buyer-category-shaped lead source.
 *
 * Unlike Google Maps (free-text query, vendor/buyer shape depends entirely on
 * query wording — see the 122 vendor-shaped `googleMaps.searches` queries this
 * fixed) or OpenStreetMap (same buyer-safe taxonomy but ODbL share-alike,
 * still pending a licence review — see memory.md), Overture Places is
 * CDLA Permissive 2.0 licensed and its Places theme carries structured
 * `phones`/`websites`/`emails`/`categories`/`confidence` fields directly —
 * verified live against Pakistan (1.22M places; dentist/lawyer/
 * real_estate_agent/accountant sitting at 60-70% email population, far
 * higher than expected going in).
 *
 * The actual fetch/cache/query logic lives in overture_fetch.py (a Python
 * helper in the same spawnSync-over-stdin-JSON shape as
 * scrapegraph_enricher.py) because the `overturemaps` package and DuckDB's
 * bbox-pruned S3 reads are Python-side tooling with no equivalent here.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CACHE_DIR = path.join('output', 'cache');

/**
 * `bbox` may be a single [w,s,e,n] box, or an array of them for a country too
 * large to pull in one request — the USA needs the latter: a whole-country
 * download died with an out-of-memory error partway through, and even half
 * the country ran long enough to be killed mid-download. Each box is cached
 * and refreshed independently; the query reads across all of them.
 */
export async function scrapeOverture(countryCode, bbox, category, opts = {}) {
  const { pythonBin, maxAgeDays = 30 } = opts;
  if (!pythonBin) {
    throw new Error('Overture source requires a resolved Python binary (needs overturemaps + duckdb)');
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `overture_${countryCode.toLowerCase()}.parquet`);

  const bboxes = Array.isArray(bbox[0]) ? bbox : [bbox];

  const input = JSON.stringify({
    bboxes,
    category,
    cache_path: cachePath,
    max_age_days: maxAgeDays,
    country_code: countryCode,
  });

  const res = spawnSync(pythonBin, ['src/scrapers/overture_fetch.py'], {
    input,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    timeout: 20 * 60 * 1000, // first call per country downloads the bbox extract; later calls just query the cache
    env: { ...process.env },
  });

  if (res.error) throw res.error;
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`overture_fetch.py exited with status ${res.status}`);
  }

  return JSON.parse(res.stdout || '[]');
}
