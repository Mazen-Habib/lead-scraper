#!/usr/bin/env python3
"""
MarkItDown fetch helper — second-rung content extractor for web tagging
(src/quality/webTagger.js), used only when Jina Reader (src/lib/jinaReader.js,
rung 1) returns null: a Jina timeout, rate-limit exhaustion, or a page its
Cloudflare-fronted endpoint refuses to serve. Not a replacement for Jina —
Jina stays the primary because it needs no local Python dependency and no
page download; this only runs when that free-and-fast path already failed.

Same stdin/stdout JSON contract as scrapling_fetch.py:
  python3 markitdown_fetch.py fetch   # stdin: JSON {"url": "..."}
                                        # stdout: JSON {"markdown": "..." | null, "error": "..." | null}

Requires: pip install "markitdown[all]"
"""
import json
import sys
import urllib.request


def log(msg):
    print(f'  [markitdown] {msg}', file=sys.stderr, flush=True)


UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'


def fetch_markdown(url, timeout_s=20):
    try:
        from markitdown import MarkItDown
    except ImportError:
        return None, 'markitdown not installed — run: pip install "markitdown[all]"'

    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            content_type = resp.headers.get('Content-Type', '')
            data = resp.read()
    except Exception as e:
        return None, f'{type(e).__name__}: {str(e)[:200]}'

    try:
        import io
        md = MarkItDown()
        stream = io.BytesIO(data)
        result = md.convert_stream(stream, url=url, content_type=content_type)
        text = (result.text_content or '').strip()
        if not text or len(text) < 50:
            return None, 'empty or near-empty conversion'
        return text[:20000], None
    except Exception as e:
        return None, f'{type(e).__name__}: {str(e)[:200]}'


def main():
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    url = payload.get('url')

    if not url:
        print(json.dumps({'markdown': None, 'error': 'no url given'}))
        return

    log(f'fetching {url}...')
    markdown, error = fetch_markdown(url, timeout_s=payload.get('timeout', 20))
    if error:
        log(f'error: {error}')
    print(json.dumps({'markdown': markdown, 'error': error}))


if __name__ == '__main__':
    main()
