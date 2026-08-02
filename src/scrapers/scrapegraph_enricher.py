#!/usr/bin/env python3
"""
ScrapegraphAI enricher — fills in missing contact info (email/phone/socials)
for leads that already have a website, by visiting the site with an LLM.

Directory scraping (TechBehemoths, Manifest) was dropped from this module:
both directories are heavily JS-rendered and ScrapegraphAI's ChromiumLoader
returned empty content for them. Native Playwright scrapers replaced them
(src/scrapers/techBehemoths.js, src/scrapers/selectedFirms.js).

Usage:
  python3 scrapegraph_enricher.py enrich   # stdin: JSON lead array → stdout: same array enriched

Key rotation order: Groq key 1→2→3 → Mistral key 1→2→3
On rate limit: rotate to next key + sleep 2s.
On other error: skip that URL and continue.
"""
import json
import os
import sys
import time

# ─── Logging to stderr (Node.js captures stdout only for data) ────────────────
def log(msg):
    print(f'  [scrapegraph] {msg}', file=sys.stderr, flush=True)

# ─── Key pool ─────────────────────────────────────────────────────────────────
GROQ_KEYS    = [k for k in [os.environ.get(f'GROQ_KEY_{i}')    for i in range(1, 4)] if k]
MISTRAL_KEYS = [k for k in [os.environ.get(f'MISTRAL_KEY_{i}') for i in range(1, 4)] if k]

def _build_pool():
    pool = []
    for k in GROQ_KEYS:
        pool.append({'llm_cfg': {'model': 'groq/llama-3.3-70b-versatile', 'api_key': k}, 'label': 'groq'})
    for k in MISTRAL_KEYS:
        try:
            from langchain_mistralai import ChatMistralAI
            pool.append({'llm_cfg': {'model_instance': ChatMistralAI(model='open-mistral-7b', api_key=k),
                                     'model_tokens': 32000}, 'label': 'mistral'})
        except ImportError:
            pass
    return pool

KEY_POOL = _build_pool()

_cursor = 0  # global key cursor — advances on rate-limit, wraps around pool

# ─── Core scrape call with key rotation ───────────────────────────────────────
def smart_scrape(url, prompt, schema=None):
    global _cursor
    if not KEY_POOL:
        log('No API keys configured — skipping')
        return None

    try:
        from scrapegraphai.graphs import SmartScraperGraph
    except ImportError:
        log('scrapegraphai not installed — run: pip install scrapegraphai')
        return None

    max_attempts = len(KEY_POOL) * 2  # allow two full rotations before giving up
    for _ in range(max_attempts):
        entry    = KEY_POOL[_cursor % len(KEY_POOL)]
        label    = entry['label']
        key_num  = (_cursor % len(KEY_POOL)) + 1
        try:
            result = SmartScraperGraph(
                prompt=prompt,
                source=url,
                config={'llm': entry['llm_cfg'], 'verbose': False, 'headless': True},
                schema=schema,
            ).run()
            return result
        except Exception as e:
            msg = str(e).lower()
            if any(x in msg for x in ['429', 'rate limit', 'quota', 'too many', 'exceeded', 'throttl']):
                log(f'Rate limit [{label} key {key_num}] → rotating to next key')
                _cursor += 1
                time.sleep(2)
            else:
                log(f'Error on {url} [{label} key {key_num}]: {type(e).__name__}: {str(e)[:120]}')
                return None

    log(f'All {len(KEY_POOL)} keys exhausted for {url}')
    return None

# ─── Pydantic schemas ─────────────────────────────────────────────────────────
try:
    from pydantic import BaseModel, Field
    from typing import Optional

    class ContactInfo(BaseModel):
        email:     Optional[str] = Field(None, description='Primary contact email address')
        phone:     Optional[str] = Field(None, description='Phone number with country code')
        linkedin:  Optional[str] = Field(None, description='LinkedIn company or profile URL')
        facebook:  Optional[str] = Field(None, description='Facebook page URL')
        instagram: Optional[str] = Field(None, description='Instagram profile URL')

    SCHEMAS_AVAILABLE = True
except ImportError:
    SCHEMAS_AVAILABLE = False
    log('pydantic not available — running without schema validation')

# ─── Prompts ──────────────────────────────────────────────────────────────────
ENRICH_PROMPT = (
    'Extract contact information from this company website. '
    'Return: email address, phone number, LinkedIn URL, Facebook URL, Instagram URL. '
    'Only include values that are explicitly present on the page — do not guess or invent.'
)

# ─── ENRICH MODE ─────────────────────────────────────────────────────────────
def enrich_leads(leads):
    needs = [l for l in leads if l.get('website') and not l.get('email')]
    log(f'{len(needs)}/{len(leads)} leads have a website but no email → enriching')

    index = {i: leads[i] for i in range(len(leads))}
    needs_idx = [(i, leads[i]) for i in range(len(leads))
                 if leads[i].get('website') and not leads[i].get('email')]

    enriched_count = 0
    for pos, (i, lead) in enumerate(needs_idx):
        name = lead.get('name', 'unknown')
        url  = lead.get('website', '')
        log(f'Enriching [{pos+1}/{len(needs_idx)}]: {name} ({url})')

        schema = ContactInfo if SCHEMAS_AVAILABLE else None
        result = smart_scrape(url, ENRICH_PROMPT, schema=schema)

        if result and isinstance(result, dict):
            for field in ('email', 'phone', 'linkedin', 'facebook', 'instagram'):
                val = result.get(field)
                if val and not leads[i].get(field):
                    leads[i][field] = val
            if result.get('email'):
                enriched_count += 1

    log(f'Enrichment done — {enriched_count}/{len(needs_idx)} leads got an email')
    return leads

# ─── Entry point ──────────────────────────────────────────────────────────────
def main():
    raw = sys.stdin.read().strip()

    if not KEY_POOL:
        log('No API keys found in env (GROQ_KEY_1…3, MISTRAL_KEY_1…3) — exiting')
        print(raw or '[]')
        return

    leads = json.loads(raw) if raw else []
    if not leads:
        log('No leads on stdin — nothing to enrich')
        print('[]')
        return

    enriched = enrich_leads(leads)
    print(json.dumps(enriched))

if __name__ == '__main__':
    main()
