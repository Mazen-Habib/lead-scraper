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

## Standing instruction from this thread

User: **"make sure not to miss anything at all"** / **"the sutomer land[s]
leads which are not lessened or made ineffective in any manner."** Read
together: prefer measuring before claiming a fix worked (this is why
`audit-leads.js` and the live double-run verification exist), and don't let a
"looks done" state stand in for a verified one. Two files were nearly
committed by an over-broad `rm` glob and had to be restored via
`git checkout --` during this session — check `git status` output for
`D` (deleted) entries specifically before every commit, not just `M`/`??`.
