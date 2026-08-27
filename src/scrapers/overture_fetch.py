#!/usr/bin/env python3
"""
Overture Maps Places fetcher — bbox-scoped country download, cached locally on
disk and re-used across every category job in the same run/day, then filtered
by category and mapped into the internal lead shape.

Why bbox+cache instead of querying S3 directly per category: Overture's Places
theme isn't partitioned by country, so a naive per-category `read_parquet(s3
glob) WHERE category = X` forces a full unpruned scan of the global theme —
measured directly: over 25 minutes with zero output before being killed. The
`overturemaps` package's bbox download instead uses the release's STAC catalog
to fetch only the row-groups whose spatial extent intersects the bbox — the
same Pakistan bbox came back in ~80 seconds. Downloading once per country and
querying the local file per category (instead of per-category remote queries)
means N categories cost one network fetch, not N.

Verified live against a real Pakistan bbox download before this was written:
1.22M places, buyer categories (dentist/lawyer/real_estate_agent/accountant)
sitting at 60-70% email population — see memory.md for the full readout.

Provenance note: Overture's `sources` field names which upstream provider fed
each place (meta/Microsoft/Foursquare/AllThePlaces/DAC/PinMeTo/Overture-signals
in the verified Pakistan sample — no OpenStreetMap contribution observed in
that bbox). Places is CDLA Permissive 2.0, not OSM's ODbL share-alike — but
this script doesn't independently verify that per-record for every country,
so treat that as a strong signal from the Pakistan sample, not a blanket legal
clearance for every country this is later pointed at.

Usage:
  python3 overture_fetch.py   # stdin: JSON {bbox, category, cache_path,
                               #   max_age_days, country_code}
                               # stdout: JSON lead array
"""
import json
import os
import sys
import time


def log(msg):
    print(f'  [overture] {msg}', file=sys.stderr, flush=True)


def ensure_cache(cache_path, bbox, max_age_days):
    if os.path.exists(cache_path):
        age_days = (time.time() - os.path.getmtime(cache_path)) / 86400
        if age_days < max_age_days:
            return
        log(f'cache {cache_path} is {age_days:.1f}d old (max {max_age_days}d) — refreshing')

    os.makedirs(os.path.dirname(cache_path) or '.', exist_ok=True)
    log(f'downloading Overture places for bbox {bbox} -> {cache_path}')
    from overturemaps import core
    import pyarrow.parquet as pq

    reader = core.record_batch_reader('place', tuple(bbox))
    writer = None
    try:
        for batch in reader:
            if writer is None:
                writer = pq.ParquetWriter(cache_path, batch.schema)
            writer.write_batch(batch)
    finally:
        if writer is not None:
            writer.close()
    if writer is None:
        # No rows at all for this bbox — write an empty file so we don't
        # re-attempt the download every job in this run.
        open(cache_path, 'a').close()
    log('download complete')


def main():
    req = json.load(sys.stdin)
    bbox = req['bbox']
    category = req['category']
    cache_path = req['cache_path']
    max_age_days = req.get('max_age_days', 30)
    country_code = (req.get('country_code') or '').upper()

    ensure_cache(cache_path, bbox, max_age_days)

    if os.path.getsize(cache_path) == 0:
        print(json.dumps([]))
        return

    import duckdb
    con = duckdb.connect()
    country_filter = "AND addresses[1].country = ?" if country_code else ""
    params = [category] + ([country_code] if country_code else [])
    rows = con.execute(
        f"""
        SELECT
          names."primary" AS name,
          categories."primary" AS category,
          websites[1] AS website,
          emails[1] AS email,
          phones[1] AS phone,
          addresses[1].freeform AS address_line,
          addresses[1].locality AS city,
          addresses[1].country AS country,
          confidence,
          id
        FROM read_parquet(?)
        WHERE categories."primary" = ?
          {country_filter}
        """,
        [cache_path] + params,
    ).fetchall()

    leads = []
    for name, cat, website, email, phone, address_line, city, country, confidence, oid in rows:
        if not name:
            continue
        leads.append({
            'name': name,
            'category': cat or '',
            'website': website or '',
            'email': email or '',
            'phone': phone or '',
            'address': address_line or '',
            'city': city or '',
            'country': country or '',
            'maps_url': f'https://explore.overturemaps.org/?share=1&id={oid}',
        })

    log(f'{len(leads)} leads for category={category} country={country_code or "any"} (confidence data not surfaced downstream yet)')
    print(json.dumps(leads))


if __name__ == '__main__':
    main()
