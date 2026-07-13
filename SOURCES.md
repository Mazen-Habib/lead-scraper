# Multi-Source Lead Strategy

How this pipeline fetches tech-industry leads from **every capable free source**, using
**two engines** — our own normal scrapers and the CloakBrowser stealth engine — with full
provenance tracking so you always know where each lead came from and how it was fetched.

## The two engines

| Engine | Column value | What it is | Used for |
|---|---|---|---|
| **Normal scraper** | `normal_scraper` | Our own Playwright browser + plain HTTP calls | Sources with no/weak anti-bot |
| **CloakBrowser** | `cloak_browser` | Stealth Chromium (C++-patched fingerprints, `humanize`) | Cloudflare/anti-bot-protected directories |

**Why two engines?** Our normal Playwright scraper gets a `403 Forbidden` on Cloudflare-
protected directories like Clutch and GoodFirms (verified — even `patchright` stealth fails
on them). CloakBrowser's source-level-patched Chromium gets `HTTP 200` on those same sites,
unlocking richer B2B firmographic data (company size, hourly rate, review counts) that
Google Maps doesn't expose. We use the lighter normal engine wherever it works and only
spend the heavier cloak engine on sites that require it.

## Quality filtering & dead-email detection

Every lead passes through a centralized quality pipeline in `src/index.js` before it's
written to CSV — no scraper needs its own filtering logic:

1. **Dedupe** — leads are deduped on a normalized URL/name key (`src/lib/normalizeUrl.js`),
   so `http://acme.com`, `https://acme.com`, `https://www.acme.com/` collapse to one lead.
2. **ICP/category filter** (`src/quality/qualityFilter.js`) — drops leads whose `category`
   (falling back to `name`) doesn't match `config.qualityFilter.categoryKeywords`.
3. **Website enrichment + MX-based email verification** (`src/quality/emailVerifier.js`) —
   after `enrichLeads` crawls each lead's website for an email, a free `dns.promises.resolveMx()`
   check marks `email_verified` as `alive` / `dead` / `unknown` (no external API/key).
4. **Contact-point filter** — drops leads with no phone, LinkedIn, or non-dead email.

Every drop is logged with a count and reason, e.g. `"7 leads dropped: off-ICP category"`.

## Provenance columns (every lead is marked)

Two columns record where each lead came from:

- **`source`** — the data source, e.g. `google_maps`, `openstreetmap`, `clutch`, `goodfirms`,
  `github_orgs`, `pseb`, `topdevelopers`, `sortlist`, `eventbrite`, `designrush`, `opencorporates`
- **`engine`** — the tool that fetched it: `normal_scraper` or `cloak_browser`

So you can always filter e.g. "show me only cloak_browser leads" or "only Clutch leads",
and score sources differently based on data quality.

## Sources

### Live (wired in and verified)

| Source | Engine | Data it gives | Status |
|---|---|---|---|
| **Google Maps** | normal | name, category, website, phone, address, rating, reviews | ✅ workhorse — best phone coverage |
| **OpenStreetMap** (Overpass API) | normal | name, category, website, phone, sometimes email/socials | ✅ great in US/EU, sparse in Pakistan |
| **Clutch.co** | cloak | name, website, location, rating, **reviews, company size, hourly rate, min project** | ✅ richest firmographics |
| **GoodFirms** | cloak | name, **website (~100%)**, location, rating, reviews | ✅ best website coverage → best email enrichment |
| **GitHub Organizations** (REST API) | normal | name, website, email (from org profile), bio, repo count | ✅ first-party API, most reliable of the batch |
| **PSEB / TechDestination** | normal | name, category, website (companies) or LinkedIn (freelancers), location | ✅ Pakistan-specific member directory |
| **TopDevelopers.co** | normal | name, website, rating, reviews, company size, hourly rate, min project, location | ✅ plain server-rendered, no cloak needed |
| **Sortlist** | cloak | name, website, reviews count, team size, location | ✅ reads `__NEXT_DATA__` JSON directly (Node fetch is TLS-fingerprinted/blocked — must use cloak) |
| **Eventbrite** | normal | organizer name, website, LinkedIn/Facebook/Instagram, event venue/address | ✅ tech-event/community organizers, not traditional agencies |
| **DesignRush** | cloak | name, website, rating, reviews, top service category | ✅ Cloudflare-protected, no location field on listing cards |
| **OpenCorporates** (API) | normal | name, company type, registered address | ⚠️ opt-in — disabled by default, needs your own `config.openCorporates.apiToken` (free key requires open-license re-release, not a fit for private lead data) |

### Evaluated, not viable — no code shipped

Each of these was tested live (curl + cloak engine, retried at least twice where a retry
could plausibly change the outcome) before being ruled out, rather than shipping a scraper
that would silently return 0 leads:

| Source | Why not |
|---|---|
| **YellowPages** | Cloudflare "Attention Required!" hard IP-reputation block — persists through the cloak engine on 2 attempts (different city query + homepage warm-up). Needs a residential/rotating proxy (`config.cloak.proxy` is already wired for this); revisit once one is available. |
| **Upwork** (agency profiles) | `403 Challenge - Upwork` even via cloak engine, confirmed on 2 attempts (including a homepage warm-up). |
| **Fiverr Pro** | Category/search pages return `200` but the actual gig grid never renders in the HTML (only 5 unrelated "related search" links, confirmed after full render + scroll, 2 attempts) — real listings are gated behind further bot detection. Freelancer marketplace contact is platform-gated anyway. |
| **PeoplePerHour** | Loads fine (`200`, no bot block) but freelancer profiles expose no company name, website, or contact info by design — just a first-name-plus-initial, to keep transactions on-platform. |
| **Crunchbase** | `403` "One moment, please…" DataDome-style challenge even via cloak engine, confirmed on 2 attempts (including homepage warm-up). Per project constraint, would only ever scrape public pages (no login automation) even if this were unblocked. |
| **G2** | `403` even via cloak engine, confirmed on 2 attempts (including a warm-up retry). |
| **Product Hunt** | `403` even via cloak engine. Official API exists but requires an OAuth token. |
| **Rozee.pk** | Cloudflare Turnstile "Just a moment..." challenge — blocks even the cloak engine's stealth Chromium. |
| **P@SHA member directory** | Directory page is a permanent "Coming Soon" placeholder — no data to scrape. |
| **AppFutura** | Effectively a duplicate of Clutch's data/format for this ICP — not worth a second scraper. |
| **SECP Pakistan registry** | A single-company lookup tool, not a browsable directory — no way to enumerate leads. Also currently returning `500`. |
| **Meetup** | Groups aren't companies and expose no contact info on their public pages. |
| **F6S** | No public, unauthenticated directory surface worth scraping. |
| **AngelList / Wellfound** | Company search is gated behind login. |
| **LinkedIn** | ToS ban risk + aggressive detection. Not worth it; use consented data instead. |
| **Paid APIs** (Apollo, Hunter) | Not free. See [RESEARCH.md](RESEARCH.md) for the paid path if you outgrow free sources. |

## Pipeline flow

```
config.json (sources + engines)
   │
   ├── NORMAL ENGINE
   │     ├── Google Maps       (Playwright)     → engine=normal_scraper
   │     ├── OpenStreetMap     (HTTP/Overpass)   → engine=normal_scraper
   │     ├── GitHub Orgs       (REST API)        → engine=normal_scraper
   │     ├── OpenCorporates    (API, opt-in)      → engine=normal_scraper
   │     ├── PSEB/TechDestination (HTTP/Cheerio)  → engine=normal_scraper
   │     ├── TopDevelopers.co  (HTTP/Cheerio)     → engine=normal_scraper
   │     └── Eventbrite        (HTTP/Cheerio)     → engine=normal_scraper
   │
   ├── CLOAK ENGINE (CloakBrowser stealth Chromium)
   │     ├── Clutch.co         → engine=cloak_browser
   │     ├── GoodFirms         → engine=cloak_browser
   │     ├── Sortlist          → engine=cloak_browser
   │     └── DesignRush        → engine=cloak_browser
   │
   ▼
Dedupe across ALL sources (normalized website/name key)
   │
   ▼
ICP/category filter (drops off-ICP leads)
   │
   ▼
Website enrichment (normal HTTP) — emails, LinkedIn, Facebook, Instagram
   │
   ▼
MX-based email verification (email_verified: alive/dead/unknown)
   │
   ▼
Contact-point filter (drops leads with no phone/LinkedIn/alive-or-unknown email)
   │
   ▼
output/leads.csv   (source + engine columns mark every row)
```

Enrichment runs on all sources uniformly — any lead that has a website gets crawled for
contact info regardless of which engine found it.

## Full CSV schema

```
company_name, category, website, email, all_emails, phone, address,
linkedin, facebook, instagram, rating, review_count,
company_size, hourly_rate, min_project,        <- firmographics (mainly Clutch/GoodFirms/TopDevelopers)
search_query, profile_url,
source, engine,                                 <- PROVENANCE
email_verified,                                 <- MX/DNS check: alive/dead/unknown
scraped_at
```

## Configuring sources

Each source is a block in [config.json](config.json) with `enabled` and its own params.
Engines are intrinsic (Google/OSM = normal, Clutch/GoodFirms = cloak). The `cloak` block
configures the stealth engine shared by all cloak sources:

```json
"cloak": {
  "headless": true,
  "humanize": true,
  "proxy": ""          // add "http://user:pass@residential-proxy:port" to unlock harder sites
}
```

**Directory/category slugs** are geography/service specific:
- Clutch: `pk/developers`, `pk/web-developers`, `ae/developers`, `us/developers/mobile-app`, …
- GoodFirms: `directory/country/top-software-development-companies/pakistan`
  (uses the **full country name**, not the 2-letter code)
- Sortlist / DesignRush `categories`: e.g. `software-development`, `web-development`
- GitHub Orgs `locations`: free-text, e.g. `Karachi`, `Pakistan`
- Eventbrite `searches`: `{ query, location }` pairs, e.g. `{ "query": "tech", "location": "pakistan" }`

## Adding a new source

1. **Inspect the live page structure first** (curl/WebFetch, or a cloak-engine dump) —
   don't guess selectors from memory. Guessed selectors silently return 0 results.
2. Write `src/scrapers/<name>.js` exporting an async function that returns leads in the
   common shape (`name, category, website, email, phone, address, rating, reviews,
   company_size, hourly_rate, min_project, maps_url, linkedin, facebook, instagram`).
3. If the site is Cloudflare/anti-bot-protected, import `openCloakPage` from
   `src/engines/cloakEngine.js` (cloak engine). Otherwise use plain `fetch`/Cheerio (normal).
   Note: a `curl`/browser `200` doesn't guarantee Node's own `fetch()` will also get through —
   some sites TLS-fingerprint and block Node's `fetch` client specifically (seen with Sortlist)
   even though curl and the cloak engine's stealth Chromium pass. Test with the actual client.
4. Register it in `src/index.js` with a `tag(leads, { source, engine, query })` call so the
   `source` and `engine` columns are stamped, and add its config block to `config.json`.
5. If the site turns out to be fully blocked or architecturally unfit (no public contact
   data, login-gated, etc.), don't ship a non-functional scraper — document it in the
   "Evaluated, not viable" table above instead.

## Scaling & proxies

- **CloakBrowser free binary is Chromium 146** and goes stale against evolving anti-bot
  systems within weeks. If Clutch/GoodFirms start blocking, either add a residential
  proxy (`cloak.proxy`) or move to CloakBrowser Pro (latest binary).
- Harder targets (YellowPages, DataDome-protected sites) need `proxy` + `headless:false`.
  The config supports `proxy` today; flip `headless` in the `cloak` block when needed.

## Compliance

Same rules apply to all sources — cold-outreach compliance (CAN-SPAM / GDPR legitimate
interest) is covered in [RESEARCH.md](RESEARCH.md). The `source` column gives you a data
provenance audit trail per lead, which matters for GDPR.
