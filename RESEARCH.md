# Lead Scraper — Research & Recommendations (July 2026)

## Goal
Build a Node.js lead scraper that collects people in tech / tech-related industries,
outputs to CSV, and feeds a downstream scoring step.

## TL;DR Recommendation
Build a **Node.js "lead agent" that orchestrates data-source APIs** rather than a raw
browser scraper. Best cost/reliability path:

1. **Primary source: Apify actors** (e.g. Apollo-database lead scrapers at ~$1–1.50 per
   1,000 leads WITH emails) called from Node via `apify-client`. You get title, company,
   industry, size, location, LinkedIn URL, email — exactly the fields needed for scoring.
2. **Email verification layer:** Hunter.io (free 100/mo) for small runs, or
   NeverBounce (~$0.008/email) / ZeroBounce for bulk — protects deliverability.
3. **Output:** normalized, deduped CSV via `csv-writer` / `json2csv`, with scoring-ready
   columns (seniority, industry, company size, tech signals).
4. **Optional enrichment for scoring:** company tech-stack (BuiltWith-style), hiring
   signals (job-board scrape via Crawlee), funding stage (Crunchbase).

Only fall back to raw Puppeteer/Playwright scraping for public directories — never
LinkedIn directly (ToS ban risk, account bans, anti-bot warfare).

## Why not scrape LinkedIn directly
- *hiQ v. LinkedIn*: scraping public data isn't a CFAA crime, but **LinkedIn won on
  breach of contract** — automated scraping violates ToS and gets accounts/IPs banned.
- LinkedIn's anti-bot detection in 2026 is aggressive; DIY scrapers need residential
  proxies, session pools, human-pacing — expensive and fragile.
- Apify actors that resell Apollo-style databases sidestep this: you buy structured
  records instead of fighting detection.

## Compliance (matters because these leads are for outreach)
- **CAN-SPAM (US):** cold B2B email is legal without consent, but requires accurate
  sender info, truthful subject, physical address, working opt-out. Fines up to
  ~$53k per email for violations.
- **GDPR (EU contacts):** B2B cold email can rely on "legitimate interest"
  (Art. 6(1)(f)) but you should document a Legitimate Interest Assessment, disclose
  the data source, and honor erasure requests. Prefer business emails over personal.
- Keep a `source` column in the CSV for every lead (auditability).

## Tooling comparison

### Data sources
| Option | Cost | Pros | Cons |
|---|---|---|---|
| Apify lead actors (Apollo-DB based) | ~$1–1.5 / 1k leads | Cheapest verified emails, filter by industry/title, Node client | Third-party DB freshness varies |
| Apollo.io API direct | $49–119/user/mo + credits | First-party, sequences built in | Credit system is expensive; export credits |
| Hunter.io | Free 25 searches/mo; paid plans | Great domain→email finder + verifier | Not a people-search DB |
| PhantomBuster | ~$59+/mo | LinkedIn automation phantoms | Uses your LinkedIn session = ban risk |
| DIY Crawlee/Playwright scraping | Infra + proxy cost | Free data, full control | Fragile, slow, legal/ban risk, no emails |

### Node.js scraping stack (for supplementary public-web scraping)
- **Crawlee** (Apify's OSS framework) — industry standard: queueing, retries, proxy
  rotation, sessions; wraps Cheerio (static HTML) and Playwright (JS-heavy pages).
- **Playwright** — best browser automation 2026 (auto-waiting, multi-browser, better
  stealth than Puppeteer).
- **Cheerio** — fast static-HTML parsing when no JS rendering needed.

### Email verification
| Tool | Free tier | Bulk price |
|---|---|---|
| Hunter.io Verifier | ~100/mo free | bundled credits |
| NeverBounce | — | ~$0.008/email |
| ZeroBounce | 100/mo free | ~$0.0195/email, credits never expire |

## Proposed architecture

```
config (ICP: industries, titles, geo, company size)
   │
   ▼
[Source adapters]  ── Apify actor (Apollo DB)   ← primary
                   ── Crawlee scraper (job boards, directories) ← signals
   │
   ▼
[Normalizer] → common Lead schema
   │
   ▼
[Dedupe] (email + linkedin_url keys)
   │
   ▼
[Verify emails] (Hunter/NeverBounce, batched)
   │
   ▼
[CSV export] → leads.csv  (+ raw JSON kept for re-processing)
```

### CSV columns (scoring-ready)
`first_name,last_name,title,seniority,email,email_status,company,company_domain,
industry,company_size,location,linkedin_url,tech_stack,hiring_signal,source,scraped_at`

## Cost estimate for a first run
- 5,000 tech leads via Apify actor ≈ **$5–8**
- Verify 5,000 emails via NeverBounce ≈ **$40** (or skip; actor emails are pre-verified-ish)
- Total well under $50 for a scored-ready list.

## Sources
- https://blog.apify.com/best-lead-scraping-tools/
- https://use-apify.com/blog/web-scraping-lead-generation-guide
- https://apify.com/curious_coder/apollo-scraper/api/client/nodejs
- https://apify.com/pipelinelabs/lead-scraper-apollo-zoominfo-lusha
- https://github.com/apify/crawlee
- https://www.scrapingbee.com/blog/best-javascript-web-scraping-libraries/
- https://docs.apollo.io/docs/api-pricing
- https://salesmotion.io/blog/apollo-pricing
- https://linkedapi.io/guides/how-to-scrape-linkedin
- https://growleads.io/blog/is-cold-email-legal-gdpr-can-spam-2026/
- https://hunter.io/api
- https://www.neverbounce.com/pricing
- https://www.zerobounce.net/email-validation-pricing
- https://scrapfly.io/blog/posts/best-public-data-sources-for-lead-generation
