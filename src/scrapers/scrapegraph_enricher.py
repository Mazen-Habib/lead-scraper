#!/usr/bin/env python3
"""
ScrapegraphAI enricher + new directory scraper.

Usage:
  python3 scrapegraph_enricher.py scrape   # stdout: JSON array of new leads from directories
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
    from typing import Optional, List

    class ContactInfo(BaseModel):
        email:     Optional[str] = Field(None, description='Primary contact email address')
        phone:     Optional[str] = Field(None, description='Phone number with country code')
        linkedin:  Optional[str] = Field(None, description='LinkedIn company or profile URL')
        facebook:  Optional[str] = Field(None, description='Facebook page URL')
        instagram: Optional[str] = Field(None, description='Instagram profile URL')

    class CompanyEntry(BaseModel):
        name:         Optional[str] = Field(None, description='Company name')
        website:      Optional[str] = Field(None, description='Company website URL (full https://...)')
        email:        Optional[str] = Field(None, description='Contact email address')
        phone:        Optional[str] = Field(None, description='Phone number')
        address:      Optional[str] = Field(None, description='City, country or full address')
        linkedin:     Optional[str] = Field(None, description='LinkedIn URL')
        category:     Optional[str] = Field(None, description='Primary service or industry')
        company_size: Optional[str] = Field(None, description='Employee count or size range')
        rating:       Optional[str] = Field(None, description='Rating score e.g. 4.8')
        min_project:  Optional[str] = Field(None, description='Minimum project budget')
        hourly_rate:  Optional[str] = Field(None, description='Hourly rate range')

    class DirectoryPage(BaseModel):
        companies: List[CompanyEntry] = Field(default_factory=list)

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

DIRECTORY_PROMPT = (
    'Extract the list of companies shown on this page. '
    'For each company return: company name, website URL (full https://... link), '
    'city and country (address), primary service category, employee count or size range, '
    'rating score, minimum project size, hourly rate, contact email, phone, LinkedIn URL. '
    'Return only companies that are explicitly listed — do not include ads or unrelated entries.'
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

# ─── SCRAPE MODE — TechBehemoths ─────────────────────────────────────────────
def scrape_techbehemoths(tb_config):
    leads = []
    queries   = tb_config.get('queries', [])
    max_pages = tb_config.get('maxPages', 2)
    schema    = DirectoryPage if SCHEMAS_AVAILABLE else None

    for q in queries:
        service = q.get('service', 'software-development')
        country = q.get('country', '')
        base    = f'https://techbehemoths.com/companies/{service}'
        if country:
            base = f'{base}/{country}'

        for page in range(1, max_pages + 1):
            url   = f'{base}?page={page}' if page > 1 else base
            label = f'{country}/{service} p{page}' if country else f'{service} p{page}'
            log(f'TechBehemoths: {label}')

            result = smart_scrape(url, DIRECTORY_PROMPT, schema=schema)
            if not result:
                break  # stop pagination on error

            companies = result.get('companies', []) if isinstance(result, dict) else []
            if not companies:
                break  # no more results on this page

            for c in companies:
                if not isinstance(c, dict):
                    c = c.model_dump() if hasattr(c, 'model_dump') else {}
                if not c.get('name'):
                    continue
                leads.append({
                    'name':         c.get('name'),
                    'website':      c.get('website'),
                    'email':        c.get('email'),
                    'phone':        c.get('phone'),
                    'address':      c.get('address'),
                    'linkedin':     c.get('linkedin'),
                    'category':     c.get('category') or service,
                    'company_size': c.get('company_size'),
                    'rating':       str(c.get('rating', '') or ''),
                    'min_project':  c.get('min_project'),
                    'hourly_rate':  c.get('hourly_rate'),
                    'source':       'techbehemoths',
                    'engine':       'scrapegraph_ai',
                    'search_query': label,
                    'scraped_at':   None,  # tagged by Node.js
                })

    log(f'TechBehemoths: {len(leads)} leads total')
    return leads

# ─── SCRAPE MODE — Manifest ───────────────────────────────────────────────────
def scrape_manifest(mf_config):
    leads = []
    queries = mf_config.get('queries', [])
    schema  = DirectoryPage if SCHEMAS_AVAILABLE else None

    for q in queries:
        category = q.get('category', 'software-development')
        country  = q.get('country', '')
        url      = f'https://manifest.co/companies/{category}'
        if country:
            url = f'{url}?country={country}'
        label = f'{country}/{category}' if country else category
        log(f'Manifest: {label}')

        result = smart_scrape(url, DIRECTORY_PROMPT, schema=schema)
        if not result:
            continue

        companies = result.get('companies', []) if isinstance(result, dict) else []
        for c in companies:
            if not isinstance(c, dict):
                c = c.model_dump() if hasattr(c, 'model_dump') else {}
            if not c.get('name'):
                continue
            leads.append({
                'name':         c.get('name'),
                'website':      c.get('website'),
                'email':        c.get('email'),
                'phone':        c.get('phone'),
                'address':      c.get('address'),
                'linkedin':     c.get('linkedin'),
                'category':     c.get('category') or category,
                'company_size': c.get('company_size'),
                'rating':       str(c.get('rating', '') or ''),
                'min_project':  c.get('min_project'),
                'hourly_rate':  c.get('hourly_rate'),
                'source':       'manifest',
                'engine':       'scrapegraph_ai',
                'search_query': label,
                'scraped_at':   None,
            })

    log(f'Manifest: {len(leads)} leads total')
    return leads

# ─── Entry point ──────────────────────────────────────────────────────────────
def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'enrich'

    # Load config.json for directory queries
    try:
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        sg = config.get('scrapegraph', {})
    except Exception as e:
        log(f'Could not read config.json: {e}')
        sg = {}

    if not KEY_POOL:
        log('No API keys found in env (GROQ_KEY_1…3, MISTRAL_KEY_1…3) — exiting')
        if mode == 'enrich':
            raw = sys.stdin.read().strip()
            print(raw or '[]')
        else:
            print('[]')
        return

    if mode == 'scrape':
        new_leads = []
        if sg.get('techbehemoths', {}).get('enabled', True):
            new_leads.extend(scrape_techbehemoths(sg.get('techbehemoths', {})))
        if sg.get('manifest', {}).get('enabled', True):
            new_leads.extend(scrape_manifest(sg.get('manifest', {})))
        log(f'Directory scrape complete — {len(new_leads)} total new leads')
        print(json.dumps(new_leads))

    elif mode == 'enrich':
        raw = sys.stdin.read().strip()
        leads = json.loads(raw) if raw else []
        if not leads:
            log('No leads on stdin — nothing to enrich')
            print('[]')
            return
        enriched = enrich_leads(leads)
        print(json.dumps(enriched))

    else:
        log(f'Unknown mode: {mode}. Use "scrape" or "enrich".')
        sys.exit(1)

if __name__ == '__main__':
    main()
