#!/usr/bin/env python3
"""
Scrapling stealth-fetch helper — used as a fallback fetch layer for directory
sources whose anti-bot defenses now block even the stealth-hardened cloakbrowser
Playwright session (src/engines/cloakEngine.js). Not a replacement for that
engine: it only runs when a source's primary cloak_browser attempt already
returned zero results (see src/scrapers/techBehemoths.js, selectedFirms.js).

Usage:
  python3 scrapling_fetch.py fetch   # stdin: JSON {"jobs":[{id,url,waitSelector?,timeout?}]}
                                      # stdout: JSON [{id,url,html,status,error}]

No API key required (unlike scrapegraph_enricher.py) — StealthyFetcher does
real browser fingerprinting locally via Camoufox, downloaded once via
`scrapling install`.
"""
import json
import sys


def log(msg):
    print(f'  [scrapling] {msg}', file=sys.stderr, flush=True)


def fetch_jobs(jobs):
    try:
        from scrapling.fetchers import StealthySession
    except ImportError:
        log('scrapling not installed — run: pip install "scrapling[fetchers]" && scrapling install')
        return [{'id': j.get('id'), 'url': j.get('url'), 'html': '', 'status': None,
                  'error': 'scrapling not installed'} for j in jobs]

    results = []
    session = None
    try:
        session = StealthySession(headless=True, network_idle=True, solve_cloudflare=True)
        session.start()
        for j in jobs:
            job_id = j.get('id')
            url = j.get('url')
            log(f'fetching {url}...')
            try:
                kwargs = {'timeout': j.get('timeout', 45000)}
                if j.get('waitSelector'):
                    kwargs['wait_selector'] = j['waitSelector']
                resp = session.fetch(url, **kwargs)
                results.append({
                    'id': job_id,
                    'url': url,
                    # NOTE: str(resp) is a repr like "<200 https://...>", not the
                    # page HTML — that's resp.html_content (a TextHandler, a str
                    # subclass, so json.dumps() serializes it as a plain string).
                    'html': resp.html_content,
                    'status': resp.status,
                    'error': None,
                })
            except Exception as e:
                log(f'error fetching {url}: {type(e).__name__}: {str(e)[:200]}')
                results.append({'id': job_id, 'url': url, 'html': '', 'status': None,
                                 'error': f'{type(e).__name__}: {str(e)[:200]}'})
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass

    return results


def main():
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    jobs = payload.get('jobs', [])

    if not jobs:
        log('No jobs on stdin — nothing to fetch')
        print('[]')
        return

    results = fetch_jobs(jobs)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
