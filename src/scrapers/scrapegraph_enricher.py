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

Key rotation order: Groq 1→2→3 → Mistral 1→2→3 → OpenRouter 1→2→3
(OpenRouter also accepts a single OPENROUTER_API_KEY, its normal case.)
Any subset works — the pool is built from whichever keys are actually set, and
the module no-ops with a log line if none are.
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

# OpenRouter: numbered pool for rotation, or a single OPENROUTER_API_KEY, which
# is the normal case there. Mirrors loadOpenRouterKeys() in
# src/classification/providers/openrouter.js so both halves of this project
# read the same env vars — numbered wins so a leftover single key cannot
# silently shadow a deliberately configured pool.
_OPENROUTER_NUMBERED = [k for k in [os.environ.get(f'OPENROUTER_KEY_{i}') for i in range(1, 4)] if k]
OPENROUTER_KEYS = _OPENROUTER_NUMBERED or [k for k in [os.environ.get('OPENROUTER_API_KEY')] if k]

# A ":free" model, so enabling this rung costs nothing.
#
# NOTE the bare model id with no "openrouter/" prefix. ScrapegraphAI is NOT a
# plain LiteLLM passthrough: it validates the provider against its own list and
# raises "Provider openrouter is not supported. If possible, try to use a model
# instance instead." for a prefixed string. So OpenRouter goes in as a
# langchain model_instance (see _build_pool) pointed at its OpenAI-compatible
# base URL, the same shape the Mistral entry already used — and the id passed
# to ChatOpenAI must be the plain one OpenRouter itself publishes.
#
# Model choice mirrors src/classification/providers/openrouter.js: verified to
# return content with zero reasoning tokens. Most of the current free pool are
# reasoning models that emit nothing within a small token budget.
OPENROUTER_MODEL = os.environ.get(
    'OPENROUTER_ENRICH_MODEL', 'google/gemma-4-26b-a4b-it:free'
)
OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

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
    # OpenRouter last: it's the fallback for regions where Groq/Mistral aren't
    # usable, so when all three are configured the faster providers lead. When
    # it's the only one configured (the expected case here) pool order is moot.
    #
    # Goes in as a model_instance rather than a 'model' string: ScrapegraphAI
    # rejects an "openrouter/..." string outright (see OPENROUTER_MODEL above).
    # ChatOpenAI works because OpenRouter's API is OpenAI-compatible — only the
    # base_url differs.
    for k in OPENROUTER_KEYS:
        try:
            from langchain_openai import ChatOpenAI
            pool.append({'llm_cfg': {'model_instance': ChatOpenAI(model=OPENROUTER_MODEL,
                                                                 api_key=k,
                                                                 base_url=OPENROUTER_BASE_URL,
                                                                 temperature=0),
                                     'model_tokens': 32000}, 'label': 'openrouter'})
        except ImportError:
            log('langchain-openai not installed — OpenRouter enrichment disabled '
                '(pip install langchain-openai)')
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
