# memory.md — lead-quality investigation, 2026-08-25

> What this is: the findings, decisions, and open questions from the session
> that moved past "is the scraper running" into "are the leads any good."
> `knowledge.md` covers engineering/CI history; `plan.md` covers the
> product-launch checklist. This file is the thread connecting a real user
> complaint to what's been measured and fixed about it so far.

---

## Where this started

User flagged, with a screenshot: filtering `Southeast Asia + Real Estate`
returned a lead in **Brooklyn, NY** and one in **Hounslow, UK**. Two of three
results on the wrong continent.

## What that turned out to be

`src/quality/geography.js`'s `resolveRegion()` does plain substring matching
(`haystack.includes(keyword)`, no word boundary) against `shared/regions.json`.
The keyword `"kl"` (Kuala Lumpur) matches inside **"Broo`kl`yn"** and
**"Par`kl`and"**. Confirmed via direct query: 24 leads tagged `southeast-asia`
*only* because of `"kl"`; 16 of those have a clearly better region available
once you look past that false match.

Same bug class as the classifier substring bug fixed earlier this week
(`src/quality/classifier.js`'s `matchesWord`) — that fix was never ported to
`geography.js`. Other short keywords with the same collision risk, not yet
measured: `"uk"`, `"usa"`, `"uae"`, `"gcc"`.

**Status: diagnosed, NOT fixed.** User redirected priority mid-investigation
("misclassification is not the thing... make sure the lead system is bullet
proof") toward the structural problems below instead. This bug is still live
in production. Fix it with the same word-boundary approach `classifier.js`
already uses — don't re-invent it, port it.

---

## The bigger thing the user actually meant

> "the leads brought are of the sellers and not the consumer or the actual
> person we want... this is not next level"

Measured, not assumed:

- **~1,950 leads** come from agency directories (Clutch, GoodFirms, Sortlist,
  DesignRush, TechBehemoths, SelectedFirms, TopDevelopers, PSEB) — these sites
  list **vendors selling services**, not buyers. Scraping "Data Analytics/BI +
  Middle East" returns eight software vendors because the industry filter
  selects for vendors by construction.
- **61% of all emails with an address (6,865 / 11,004) are role inboxes** —
  `info@`, `sales@`, `hello@`. Reception desks, not decision makers.
- **The schema has no contact-person fields at all.** No `contact_name`,
  `title`, `role`. Nowhere for a named person to live even once found.

### The free fix nobody had noticed
`src/scrapers/emailFinder.js`'s `CANDIDATE_PATHS`/`DEEP_CANDIDATE_PATHS`
**already crawl `/about`, `/team`, `/leadership`, `/contact`** — exactly the
pages decision-makers are listed on — and throw the names away, keeping only
whatever email/social links it finds. Extracting `contact_name` + `title` from
pages already being downloaded is a zero-marginal-cost win, not a new scraper.
**Not yet built.** This is the highest-leverage next step and it's free.

### User's actual ICP, verbatim
Asked to choose one of: local-business buyers / intent-signal companies /
agencies-as-customers / lead-data resale. Answer: **"all the above... we need
to expand more."** Don't narrow the targeting on their behalf — the product
is meant to serve all four, which is why the agency-directory sources aren't
simply wrong to keep, just need to stop being presented as if they were
buyer-quality leads.

---

## scripts/audit-leads.js — the measurement tool (built, committed, live)

Answers "what fraction of the database is actually usable" instead of trusting
the total-row count. Definition of **actionable**: real row (not a corrupt
CSV-fragment name) + reachable human (email/phone/linkedin, email not dead) +
has a region + has an industry.

**Live result at time of writing: 14,808 total → 11,698 actionable (79%).**

Run it: `node scripts/audit-leads.js` (add `--json` for CI, `--strict` to
exit 1 on any critical-severity row, `--sample N` for more examples per
issue). Also reports coverage by region/industry, contact reachability,
classification provenance, and freshness — use it before quoting any "we have
X leads in Y" number, the honest figure is usually lower.

Known issues it surfaced, not yet fixed:
- 38 rows with a corrupt `name` field (CSV columns shifted — literally a
  comma-joined blob of other fields, e.g. `,https://facebook.com/...`)
- 1,079 leads with no resolvable region, 2,309 with no industry — invisible
  to the corresponding dashboard filter entirely
- 28 excess rows across colliding dedupe keys

---

## Duplicate-rescrape waste — measured, and the first fix is shipped

Pulled real phase timings from the last successful weekly run's log:

```
Scraping sources              2h 00m   57%
Website email crawl             38m    18%
ScrapegraphAI enrichment        30m    14%
Classification                  19m     9%
```

That run scraped **10,577 leads**; the master grew by **~1,300**. So **~88%
of a typical run's scraped leads are already-known duplicates**, and the
pipeline was still spending the full website-crawl + enrichment cost on all
of them, because neither `enrichLeads()` nor the pipeline knew a lead was
already fully known until Supabase merge — which happens at the very end.

**Shipped (commit `010d0bd`):**
1. `enrichLeads()` now skips a lead already holding both an email and a
   linkedin — previously it re-crawled regardless.
2. `runPipeline()` gained an opt-in `knownByKey` map; a new
   `backfillFromKnown()` fills a re-scraped duplicate's empty fields from the
   matching Supabase record right after dedupe, *before* the enrichment step
   — which is what lets check #1 actually recognize the lead as already known.
3. `main()` now logs `N/total scraped leads already known` on every run —
   turns the 88% figure from a one-off calculation into an ongoing metric.

Verified live (not just unit tests): ran `--only=pseb` twice back to back.
First run — `0/37 already known`. Second run, against the master the first
run had just synced — `6/37 (16%) already known` →
`Backfilled known fields onto 6 already-seen leads`, and those 6 correctly
skipped the website crawl. Both runs synced cleanly.

**Not yet done — discussed, not built:**
- Skipping the *listing/detail-page fetch itself* for known duplicates (only
  the post-scrape enrichment is skipped so far). Google Maps genuinely can't
  avoid this — you don't know who's in the results until you look — but
  businesslist.pk/ng's category-listing → detail-page hop could skip the
  detail fetch entirely once the listing URL alone reveals it's a known
  company. Real remaining time-savings, not yet built.
- Per-source checkpoint sync (sync to Supabase after each source finishes,
  not only at the very end). Motivated by the Aug 23 run that hit a 6-hour
  timeout and lost the *entire* run's output because nothing had been synced
  yet — now fixed for the *cause* of that timeout (duplicate source scraping,
  see `knowledge.md`), but checkpointing would make any future long run
  resilient to a similar loss regardless of cause. Not built.
- Query rotation instead of daily full re-scrape. User asked about daily
  cadence; recommended rotating the ~128 Google Maps queries across days
  instead of scraping all of them daily (which would just inflate the 88%
  duplicate rate further) — not built, needs a decision on rotation scheme
  first.

---

## Paid API research — no purchase made, pricing not locked in

Recommended, in priority order, contingent on the free decision-maker
extraction being built and measured first (no sense paying to duplicate what
free enrichment might already recover):

1. **Apollo.io** (~$49–99/mo, has a free tier to trial) — named contacts +
   titles + verified emails, the direct fix for the role-inbox problem.
2. **MillionVerifier** (~$27 one-time for ~50k credits) — real email
   verification; current MX check only proves the domain accepts mail, not
   that the mailbox exists.
3. **Snov.io / Hunter.io** (~$35–40/mo) — cheaper domain→person lookup,
   smaller database than Apollo.
4. **Serper.dev / Outscraper** (~$50/50k searches, ~$3/1k Maps records) — API
   alternative to the fragile Playwright Google Maps scraping; would also cut
   scrape time.
5. Intent-signal tier (PredictLeads, Crunchbase API ~$49/mo) — not urgent,
   revisit once the buyer-vs-seller sourcing question is settled.

**Explicit caveat given to the user:** pricing above is order-of-magnitude,
not verified live — confirm on each vendor's site before quoting a number to
their boss. Suggested a lean ~$60–75/mo + one-time $27 starting stack
(Apollo free tier + MillionVerifier) to prove value before a subscription
commitment.

**Nothing has been purchased or integrated.** This is a shopping list, not a
todo list — don't build against any of these until the user confirms a
selection.

---

## Open threads, in the order they were raised

1. Fix the `"kl"`/short-keyword region substring bug (`geography.js`) —
   diagnosed, deprioritized by the user, not fixed. Low effort, same pattern
   as the already-fixed classifier bug.
2. Build free decision-maker extraction from already-crawled
   about/team/leadership pages — highest leverage, zero cost, not started.
3. Add country + city granularity to region filtering (user's literal
   "vasten the filters" ask) — not started.
4. Purge the 38 corrupt-name rows; wire `audit-leads.js --strict` into CI so
   that class of row can't silently return.
5. Recover the 1,079 region-less + 2,309 unclassified leads.
6. Per-source checkpoint sync; query rotation for daily cadence; skip the
   detail-page fetch (not just enrichment) for known directory duplicates.
7. Decide on a paid enrichment vendor once (1) is measured — see the API
   research above.

---

## ICP clarification + cost-at-scale analysis (2026-08-25, later same day)

### The ICP, restated precisely
User confirmed the earlier "all of the above" answer in more concrete terms,
using the real-estate result as the example: leads should be **actual local
businesses who would *buy* services** (dentists, real estate agencies,
restaurants, clinics), **not agencies/vendors who *sell* those same
services** (web dev shops, marketing agencies, freelancer directories). The
Brooklyn/Hounslow region bug and the seller-pollution problem are different
bugs, but the real-estate screenshot conflated both — worth re-checking that
example specifically once the region bug is fixed, to confirm how much of it
was misclassification vs. genuine seller-type sourcing.

**Practical effect on sourcing:** the agency-directory sources (Clutch,
GoodFirms, Sortlist, DesignRush, TechBehemoths, SelectedFirms, TopDevelopers,
PSEB, GitHub Orgs — see the seller-vs-buyer breakdown above) aren't wrong to
keep for the "sell to agencies" / "resell lead data" slices of the ICP, but
they should stop being presented as if they were buyer-quality inside a
generic industry filter like "Real Estate." Not yet built: some way to
distinguish "vendor learning to appear in this vertical" from "genuine local
buyer in this vertical" at the data level, not just at the source level.

### Volume constraint that reframes everything: ~150,000 NEW leads/month wanted
This changes which tools are even viable, independent of per-unit price.

### First recommendation (Google Places API) — given, then corrected same session
Initially recommended Google Maps Platform / Places API as "official, reliable,
~$17/1000, genuinely cheap, use liberally" and as the structural fix for
seller-pollution (Places' category taxonomy is precise; agency listings and
real local businesses are distinguishable there in a way keyword-search
Maps scraping isn't).

**That recommendation was corrected once real volume math was done in the same
conversation.** At 150k/month, Details calls alone (~$17-20/1000) run
**~$2,500-3,000/month**, before search calls; realistic total
**~$3,000-5,000+/month, ongoing**. Not "cheap, use liberally" — a real
recurring line item, same order of magnitude as the Apollo pricing the user
had already ruled out. **Lesson recorded explicitly because it was a real
misstep, not hedging:** do the per-1000 x expected-volume multiplication
BEFORE calling anything "cheap" — a correct per-unit price can still be an
incorrect recommendation once multiplied by the user's actual scale. Re-verify
this arithmetic before ever repeating the Places API recommendation.

### The framing that actually fits the volume + cost + ICP constraints together
User's own observation, correct and worth protecting: **"scrapping isnt
google maps only, it has a lot of different aspects to it."** The existing
pipeline already runs 14+ free sources (Google Maps scraper, OpenStreetMap,
businesslist.pk/ng — 383 of 388 categories still untouched, GitHub Orgs, the
agency directories). At 150k/month, this free multi-source pipeline is the
project's actual structural cost advantage, not a stopgap to be replaced by a
paid API. The right shape of solution:

1. **Discovery/volume stays on the free scraper stack.** Expand it (more
   businesslist categories, more OSM city/category combos, wider Maps query
   coverage) rather than buying discovery volume from Places/any paid source.
   Paid discovery only makes sense as a narrow gap-filler for a specific
   city/category combo the free sources genuinely can't reach.
2. **Decision-maker enrichment**, the actual "god-tier" requirement, should
   be free-first at this volume: the already-crawled about/team/leadership
   pages (see the earlier entry in this file — still not built) are the only
   enrichment path whose cost doesn't scale with volume. This got MORE
   important, not less, once 150k/month was named as the target — every
   per-lookup paid enrichment tool (Apollo, Hunter, Snov, ZoomInfo, Lusha)
   becomes $7,500-15,000+/month at this scale regardless of which vendor,
   because the problem is the per-record pricing model itself, not any one
   vendor's rate.
3. **Bulk email verification (MillionVerifier)** is the one paid tool that
   stays cheap at this volume — bulk pricing, not per-lookup — roughly
   $90-150/month for 150k emails. Recommended as the one paid piece worth
   adding regardless of ICP/sourcing decisions.
4. **True wholesale/bulk-licensed B2B data** (Cognism, Data Axle, or similar)
   was named as the only category of paid vendor that's actually built for
   six-figure-monthly volume affordably — but it's a negotiated sales
   conversation, not a self-serve key, and is a separate track from anything
   buildable without that conversation happening first.

### Explicit ruling from the user
**Apollo is ruled out — "too expensive."** Don't re-propose it without a
volume or budget change from the user first.

### Revised priority order coming out of this discussion
1. Free decision-maker extraction (already the top item above — now doubly
   justified by the volume math, still not started)
2. Expand free-source breadth (businesslist categories, OSM, Maps query
   coverage) rather than any paid discovery API
3. MillionVerifier once free extraction is producing contacts to verify
4. Region bug fix + re-audit the real-estate example specifically once fixed,
   to separate the misclassification effect from the genuine sourcing effect
5. Bulk/wholesale data-licensing conversation — flagged as real and eventually
   necessary for full 150k/month named-contact coverage, but explicitly a
   later, separate track requiring the user's own sales conversation, not
   something to build toward by default

---

## Worldwide buyer-only sourcing (2026-08-27) — Overture Maps added as a source

User's real question: "make sure the scraping is of customers and always
that, no sellers" combined with "we want scrapers to run all day, all night,
all over the world" — i.e. buyer-purity AND global scale, not either alone.

**Corrected a premise before acting on it.** Google Maps is not the seller
problem — it's neutral, returns whatever the query text asks for.
`googleMaps.searches` was 122/122 vendor-shaped query STRINGS ("software
companies in X"), while `googleMapsGeneral.searches` (354 queries, same
scraper) was already 100% buyer-shaped. The fix was rewriting query text, not
dropping the source — would have deleted the dentists/hospitals/law-firms
data along with the vendors.

**What shipped, in order:**
1. Rewrote all 122 vendor-shaped `googleMaps.searches` into 116 buyer-shaped
   queries (retail, gyms, auto repair, accounting/insurance, home-services
   contractors, veterinary, event venues, salons) across the same 58 cities —
   config-only, zero new code.
2. Disabled (`enabled: false`) the 9 vendor-only-by-construction sources
   (Clutch, GoodFirms, Sortlist, DesignRush, TechBehemoths, SelectedFirms,
   TopDevelopers, PSEB, GitHub Orgs — was 26% of the DB) from future
   scrape/sync, per the user's explicit answer to an AskUserQuestion — their
   code is untouched, just toggled off. ~4,135 already-synced vendor leads in
   Supabase were deliberately NOT touched/deleted — that's a separate,
   still-open decision.
3. **Added Overture Maps Places as a new source** (`src/scrapers/overture.js`
   + `src/scrapers/overture_fetch.py`, registered in `SOURCE_REGISTRY` as key
   `overture`). Why: Linux Foundation project (Meta/Microsoft/Amazon/TomTom
   backed), 61M+ global POIs, **CDLA Permissive 2.0 license — no share-alike**
   (unlike OSM's ODbL, see below), schema carries `phones`/`websites`/
   `emails`/`categories`/`confidence` directly.

**Measured before trusting it (learned from the Places-API cost mistake
earlier — verify, don't assume).** First attempt (naive
`read_parquet(s3_glob) WHERE country=X`) stalled 27 minutes with zero output
and had to be killed — Overture's Places theme isn't partitioned by country,
so that scan forces reading a large share of the global dataset before
anything can be pruned. Fixed by using the `overturemaps` Python package's
bbox-download (uses the release's STAC catalog for spatial pruning) — same
Pakistan bbox came back in ~80s. **Real, live-measured numbers for Pakistan
(1.22M places in the bbox):** dentist 6,526 leads (96% phone / 45% website /
**63% email**), lawyer 2,941 (91%/54%/**69%**), real_estate_agent 4,568
(90%/51%/**62%**), accountant 1,668 (96%/64%/**69%**), gym 10,894
(86%/30%/44%), hospital 24,313 (74%/31%/34%). Email coverage came back much
higher than expected going in — worth remembering as the opposite kind of
surprise from the Places-API cost mistake (that one was "cheaper than
expected," corrected down; this one was "better data than expected,"
confirmed by measurement, not assumed).

**Provenance check, relevant to the OSM licence question below:** Overture's
`sources` field names each place's upstream contributor. In the verified
Pakistan sample: meta, Microsoft, Foursquare, AllThePlaces, DAC, PinMeTo,
Overture-signals — **no OpenStreetMap contribution observed**. Good signal
that Overture Places is a genuinely independent alternative to OSM for this
country, not just an OSM repackaging — but this was checked on one country's
sample, not exhaustively, so don't treat it as a blanket guarantee for every
country before pointing Overture at a new one.

**Real bug found and fixed while wiring this in:**
`src/quality/geography.js`'s `resolveGeo()` built its match haystack only from
`lead.address` + `lead.search_query` and ignored any country field a source
already supplied — so Overture leads (which DO carry a real ISO alpha-2
country code, e.g. `PK`) still came back `country: null` for 55/58 leads in a
test batch, because Overture's Pakistan addresses/city names are in Urdu
script, unmatchable by the English keyword lists. Fixed by adding an
`ISO2_TO_SLUG` map (the same ~64 countries `shared/geo.json` already
supports) and preferring a source-supplied 2-letter code over keyword-guessing
when address-text matching fails — city-keyword matching still wins first
when it succeeds (more specific). Verified: country resolution on the same
test batch went from 3/58 to 58/58. All 185 existing tests still pass — this
only adds a new fallback path, doesn't change behavior for sources that don't
set `lead.country`.

**Wired into `weekly-scrape-general.yml`** (the buyer-vertical Wednesday run):
added `overturemaps`/`duckdb` pip install, an `actions/cache` step keyed by
ISO week for the ~250MB-per-country bbox download (config's own
`cacheMaxAgeDays: 30` is the real freshness control — the cache step just
avoids re-downloading inside one calendar week), and `overture` added to that
workflow's `--only=` list. Scoped to Pakistan only for now
(`config.json`'s `overture.countries`) — adding more countries is just adding
more bbox entries to that config array, each one costs one more ~1-2 min
download the first time, then reads from its own cache file.

**Still genuinely open, not resolved:**
1. **OSM licence question** (ODbL share-alike vs. this project's merged
   Supabase table) — needs an actual lawyer, not an engineering fix. Interim
   safety: OSM-derived rows are already identifiable via the existing
   `source = 'openstreetmap'` column, so segregating them later (if the legal
   review requires it) doesn't need new schema — this was checked, not
   assumed.
2. **businesslist.pk/ng category widening** — deliberately NOT done this
   session. The spider's `DEFAULT_CATEGORIES` (30 of 300+ available) were
   already a deliberately verified, curated set (wrong slugs 404, documented
   in the spider's own docstring) and the Wednesday job is already time-budgeted
   close to its ceiling — widening this needs live slug verification against
   the real site plus a runtime test, not a guess.
3. **Continuous/always-on runtime** (the "all day, all night" half of the
   ask) — deliberately NOT started. Overture's bbox-query model already
   removes most of the reason a continuous worker was being considered
   (discovery is now a bounded query, not an unbounded crawl), so this may
   need less infrastructure than originally scoped — worth re-scoping AFTER
   Overture's real throughput is seen in production, not before.
4. **~4,135 already-synced vendor leads in Supabase** from the now-disabled
   sources — still present, not purged, not moved. A separate decision from
   "stop future syncing," deliberately not acted on without an explicit ask.

---

## Standing instruction from this thread

User: **"make sure not to miss anything at all"** / **"the sutomer land[s]
leads which are not lessened or made ineffective in any manner."** Read
together: prefer measuring before claiming a fix worked (this is why
`audit-leads.js` and the live double-run verification exist), and don't let a
"looks done" state stand in for a verified one. Two files were nearly
committed by an over-broad `rm` glob and had to be restored via
`git checkout --` during this session — check `git status` output for
`D` (deleted) entries specifically before every commit, not just `M`/`??`.

---

## businesslist.pk category widening (2026-08-27)

Widened `businesslist_pk.py`'s `DEFAULT_CATEGORIES` from 34 to 67 categories
(Pakistan only). Every added slug was pulled live from
businesslist.pk's own `/browse-business-directory` DOM via a real browser
session (`document.querySelectorAll('a[href*="/category/"]')`), not guessed —
the site actually has **1,131 categories** total (docstring's old "300+"
estimate was stale), and a wrong guess 404s (already known from the original
34). Spot-checked 3 of the new ones live before trusting them in a cron job:
`/category/dentists` really renders "473 listings in Pakistan"; a local test
crawl of `schools,child-daycare-services,security` (max_pages=1) came back
58/58 requests at HTTP 200, 54 real leads, ~30 pages/min — matches the
existing documented throughput exactly.

New categories deliberately stayed buyer-shaped (healthcare, legal, real
estate, hospitality, education, home/professional services, beauty/wellness)
and skipped the site's own "Computers & Internet" and "Business
Services"/Consulting sections — those are vendor-shaped the same way
`googleMaps.searches` was, and widening this source shouldn't reintroduce
that bias through a different door. Some new categories (dentists,
restaurants, hotels) overlap what Google Maps/OSM already cover for
Pakistan — left in anyway, since this is a third independent source and
`dedupeKey()` already merges true duplicates; it still adds whatever those
two sources missed.

**Nigeria's category list was deliberately NOT touched.** Its 40s/request
`Crawl-delay` (already documented in `scrapy-scrape.yml`'s own budget
comments) makes category expansion expensive in a way Pakistan's list isn't —
widening NG the same way would blow the job's 300-minute ceiling. Also
noticed in passing: the NG workflow's default 10-category fallback includes
`insurance-companies`, which doesn't appear on `businesslist.com.ng`'s own
browse page (though the platform's categories are shared cross-country per
the spider's docstring, so it may just have zero current NG listings rather
than being a dead slug) — not fixed, flagged here in case it's worth
checking later.

**Time-budget adjustment, not just a category-list edit:** cut
`scrapy-scrape.yml`'s `pk_max_pages` default from 8 to 4 (both the
`workflow_dispatch` field default AND the bash `|| '4'` fallback the actual
Friday cron run uses — the workflow_dispatch default alone does NOT apply to
scheduled runs, easy to miss). 67 categories x 4 pages (268 total) keeps
total page volume close to the old 34 x 8 (272), trading per-category depth
for category breadth rather than growing the job's runtime — verified against
the same ~30 pages/min the workflow's own comments already measured live.

---

## Overture category widening + dashboard default (2026-08-27, same day)

Dashboard fix, not just a data fix: the vendor/buyer split (`lead_type`
column, added by an earlier session) already existed and was already computed
correctly, but `LeadsTable.tsx`'s default filter was `leadType: "All"`, so
the ~4,135 vendor leads from the now-disabled sources were still shown to
customers by default, just with an amber "Vendor" badge. Changed the default
to `buyer` so they're hidden on first load; "All" is still a real one-click
dropdown option, nothing was deleted or made inaccessible.

Caught a real bug while verifying this in the browser rather than trusting
the diff: there were actually two separate hardcoded "All" defaults —
`DEFAULT_FILTERS` and a second one inside `filtersFromInitialQuery()`
(`q.leadType ?? "All"`), which is the one that actually applies on first page
load since the page always passes an initial query object. Editing only
`DEFAULT_FILTERS` looked correct in the diff but did nothing when checked
live — a hard reload still showed "All" selected. Fixed both; confirmed via a
real dev-server session that the dropdown's value is "buyer" on load. Worth
remembering as a concrete case of the standing "measure before trusting a
fix worked" rule below, not just an abstract principle.

Overture Pakistan widened from 10 to 40 categories, using real category
names and counts read directly from the already-cached
`output/cache/overture_pk.parquet` (no new download, no guessing — Overture's
own taxonomy names, e.g. `financial_service`, `property_management`,
`home_developer`). Measured contact-field coverage for all 30 new categories
before adding any: lowest was `elementary_school` at 23% email and
`financial_service` at 14% email (though phone/website stayed strong there,
95%/89%); most sat 30-77% email. Deliberately excluded the vendor-shaped
categories present in the same taxonomy (`software_development`,
`information_technology_company`, `marketing_agency`,
`it_service_and_computer_repair`, `computer_store`, `computer_coaching`,
`industrial_company`, `wholesale_store`) and non-commercial/institutional
ones (`mosque`, `church_cathedral`, `hindu_temple`, `sikh_temple`, `park`,
`bus_station`, `atms`, `police_department`, `post_office`,
`central_government_office`) — same buyer-only discipline as the businesslist
widening above, applied to a different source's own taxonomy.

No runtime-budget concern here, unlike businesslist's page-count math:
Overture categories query the already-cached local parquet file, not a fresh
network fetch per category — verified live, a 3-category test
(school/construction_services/interior_design) returned 10,732 leads with no
new download, near-instant per category. This is the concrete case of the
"discovery becomes a bounded query, not a crawl" argument from the original
sourcing report — 30 more Overture categories cost nothing extra in
wall-clock time, unlike the 33 more businesslist categories, which did need
the pk_max_pages adjustment since that source really does re-request per
category.

---

## Overture widened further: 92 categories, 2nd country (2026-08-27, same day)

Widened Pakistan's Overture category list from 40 to **92** — went deeper into
the same live `output/cache/overture_pk.parquet` taxonomy (ranked categories
100-220 by count, not just the top 100 checked earlier), measured
phone/email coverage for all 52 new additions before adding any (weakest:
`travel_agents` and `money_transfer_services` at ~0% email but 100% phone —
kept anyway since the pipeline's contact-point filter accepts phone-only).
Same buyer-only discipline: skipped `web_designer`, `social_media_agency`,
`internet_marketing_service`, `graphic_designer`, `employment_agencies` (all
vendor/B2B-service-shaped) and `library`/`corporate_office` (not real leads).

**Added UAE as a second Overture country** — downloaded and checked its bbox
(51.5795, 22.4969, 56.3968, 26.0693) before committing to it, not after:
140,004 places in the raw bbox, 138,214 after the existing country filter
(the bbox spills slightly into Qatar/Oman, `overture_fetch.py`'s
`country_filter` already handles this correctly since it was built for
exactly this). All 92 PK-vetted categories are present in the UAE data too —
51,302 leads across them, contact coverage as strong as Pakistan's. Ran a
real end-to-end pipeline test on 3 UAE categories before considering this
done: 47/47 leads resolved `country=uae` and `lead_type=buyer` correctly (the
ISO2_TO_SLUG map added earlier already had `AE`, so no code change was needed
for this, just config). No CI workflow edit was needed either — the
`overture` SOURCE_REGISTRY entry already loops over every country in
`config.overture.countries`, so `weekly-scrape-general.yml`'s existing
`--only=...,overture` picks up AE automatically.

## Two research deliverables produced, no code changes

**Always-on runtime scoping** (published as an artifact, not just discussed):
pulled ACTUAL GitHub Actions usage via `gh api .../actions/runs` rather than
estimating from workflow timeouts — **2,893 minutes in the last 30 days**,
already over the personal-account free tier of 2,000. 783 of those minutes
were from a since-deleted `nightly-scrape.yml` (added 13 Jul 2026, since
replaced by the current weekly split) and won't recur; real steady-state
from the 5 current workflows is ~2,110 min/month, still slightly over.
Overage cost itself is trivial (~$1/month at the post-Jan-2026 $0.008/min
rate) — the real constraint is job-timeout-shaped batches, not dollars.
Recommendation: don't build general-purpose always-on infrastructure: keep
discovery (Maps/OSM/businesslist/Overture's bbox refresh) on the existing
weekly cadence since none of them benefit from running more often after this
session's changes, and put a small Hetzner CX22 (~$5-9/month, current 2026
price after Hetzner's June rise) on enrichment specifically — the one piece
that's genuinely bottlenecked by batch windows. Re-measure GH Actions minutes
after that lands before spending on anything more.

**OSM licence question** (published as an artifact, written for an actual
lawyer to read, not a legal opinion): states the fact pattern precisely
(ODbL data merged into the same table as non-ODbL sources via `dedupeKey()`,
`source` column already makes OSM-derived rows identifiable), quotes ODbL's
own share-alike summary, and poses the specific open question (does merging
create a Derivative Database whose obligation could reach the whole table).
Explicitly makes no legal claim of its own. Notes the Overture provenance
finding (no OSM contribution observed in the Pakistan sample) as a fact that
may narrow the question, not as grounds to assume the question is already
answered.

Neither deliverable changed OSM usage, added new infrastructure, or reached
a legal conclusion — both are inputs to a decision the user (and, for the
licence question, an actual lawyer) still needs to make.

---

## Sources dropdown bug — found while answering an unrelated question (2026-08-27)

User asked "what do these sources mean?" pointing at the dashboard's Sources
filter showing only `businesslist_ng`/`businesslist_pk` as options. Checked
rather than explained it away — this was a real production bug, not a
misunderstanding.

`fetchLeadFacets()` in `free-nextjs-admin-dashboard-main/src/lib/leads.ts`
ran `.select("source").not("source","is",null)` with no explicit
`.range()`/`.limit()`. PostgREST silently caps an unranged query at 1000
rows. Verified live: the naive query returned exactly 1000 rows; paginating
through the full ~15,927-row table found **13 real distinct sources**, but
the first 1000 rows (apparently the most recently inserted — this session's
businesslist widening work) happened to be entirely `businesslist_ng`/`_pk`.
Customers filtering leads by source saw 2 of 13 options, silently, with no
error. (Also found: one row has `source = ''` — a data-quality issue, not
fixed, not investigated further.)

Fixed at the database layer, not by paginating client-side: added
`supabase/migrations/0012_distinct_sources_rpc.sql`, a
`distinct_lead_sources()` Postgres function doing a real `SELECT DISTINCT`
server-side, and pointed `fetchLeadFacets()` at it via `.rpc()`. Paginating
through the whole table on every dashboard load doesn't scale toward the
150k/month target; one indexed DISTINCT query does.

**Applied directly to production** via `scripts/apply-migration.js` and
`SUPABASE_DB_URL` (a raw Postgres connection, not the Supabase MCP tool —
that MCP's connected account doesn't include this project; checked via
`list_projects` first rather than assuming). Verified twice: the RPC alone
returns the correct 13 sources, and a live dev-server session confirmed the
dashboard's actual dropdown now lists all 13. `overture` is correctly absent
from that list — it hasn't been run against production yet, only tested
locally in this session.
