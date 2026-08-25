# Launch plan

> Companion to the in-chat "Launch Readiness" report and "Path to Launch" flowchart
> (2026-08-25) — this is the durable, repo-native version so it survives outside
> that conversation. Numbers below were pulled live from production Supabase and
> from a direct read of this repo and `free-nextjs-admin-dashboard-main/` on that
> date; re-verify before trusting them if this file is old when you read it.

## Verdict

**Not ready to launch publicly yet.** The scraper + CI side is genuinely solid —
five automated weekly workflows, all confirmed green after this week's fixes. The
blocker is entirely on the dashboard side: it currently has no real access control
in production.

## Current state (as of 2026-08-25)

| | |
|---|---|
| Total leads | 14,808 |
| Have an email | 11,004 (74%) |
| Have a phone | 9,071 (61%) |
| Tier A / B / C / D | 1,102 / 2,967 / 7,609 / 3,130 |
| Automated weekly workflows | 5 (all confirmed healthy) |

Stack: Node.js 24 scraper + Scrapy, 14 sources + businesslist.pk/ng, Next.js
dashboard (TailAdmin template, MIT licensed), Supabase, Vercel, GitHub Actions CI,
Cloudflare/OpenRouter for LLM classification and enrichment.

## Blockers, ranked

### Critical

1. **Auth fails open, not closed.** `AUTH_DISABLED` in
   `free-nextjs-admin-dashboard-main/src/lib/dev-auth.ts` defaults to `true`
   unless `NEXT_PUBLIC_DISABLE_AUTH=false` is explicitly set. The production
   Vercel deployment is running that default right now — no login wall, the full
   database (names, emails, phone numbers) readable by anyone with the URL. Fix
   this first, and verify it live on the deployed URL, not just in the code.

2. **No access control even once auth is on.** Signup is fully open
   (`SignUpForm.tsx` calls `supabase.auth.signUp` with no invite gate). No plan
   tiers, no billing integration anywhere in the codebase. Turning auth on alone
   doesn't make this a business — it just moves "free for anyone" behind a
   signup form.

### High

3. **No Terms of Service or Privacy Policy.** Neither exists. Needed before
   collecting user accounts, and separately before republishing scraped personal
   business-contact data to customers.

4. **Scraped-source terms haven't been reviewed for resale.** `robots.txt` was
   checked for businesslist.pk/ng specifically. Google Maps, Clutch, GoodFirms,
   Sortlist, etc. each carry their own terms on scraping/reselling, unreviewed.
   Reselling contact data also raises jurisdiction-dependent questions
   (CAN-SPAM, GDPR, PECR).

### Medium

5. **No rate limiting** on `/api/leads`, `/api/saved-searches`, or related
   routes.

6. **The pipeline is still young.** 21% of the database is Tier D. The score
   floor, the classifier, and LLM provider throttling all had real bugs found
   and fixed in the days immediately before this plan was written — argues for
   a stability soak before charging money on top of it.

### Low

7. **Vercel's free Hobby tier excludes commercial use** per Vercel's own terms.
   Budget for at least the Pro plan before announcing anything.

## Path to launch

Five phases. Phase 0 is a hard gate — all three of its items must be true before
anything else starts. Phases 1 and 2 then run **at the same time**; both must
finish before Phase 3. Phase 4 has no end date.

### Phase 0 — Lock the doors (blocking, do first)

- [ ] Flip the auth default to fail-closed in code, not just via env var
- [ ] Set `NEXT_PUBLIC_DISABLE_AUTH=false` on the live Vercel deployment and
      verify the login wall actually renders
- [ ] Gate signup behind an invite code or waitlist

### Phase 1 — Private beta (2–4 weeks, parallel with Phase 2)

Invite 10–20 real target users, free, and watch:
- which filters get used vs. ignored
- how often a lead gets flagged wrong or stale
- whether the weekly refresh cadence is felt as valuable or just noise

### Phase 2 — Wire up the business (parallel with Phase 1)

- [ ] Pick one pricing model (seat-based monthly, or metered credits — not both
      on day one)
- [ ] Integrate Stripe
- [ ] Gate exports and saved searches by plan
- [ ] Ship the ToS + Privacy Policy (a generator like Termly/Iubenda is a fast
      start)

### Phase 3 — Public launch (both tracks must be done first)

- [ ] Open signup behind the paywall
- [ ] Announce — "fresh leads every week" is now a true claim, not marketing
      copy, given the CI is confirmed solid

### Phase 4 — Harden in production (ongoing, no end date)

- [ ] Add rate limiting
- [ ] Add failure alerting (Slack/email webhook) for the five scheduled
      workflows, instead of a manual `gh run list`
- [ ] Get a real legal read on the 3–4 highest-volume scraped sources once
      revenue justifies the cost

## Full punch list

### Security & access
- [ ] Flip the auth default to fail-closed
- [ ] Verify production shows a real login wall
- [ ] Gate signup (invite code / waitlist)
- [ ] Confirm the data-sharing model on purpose — the leads table currently
      looks global/shared across all users (no `user_id` scoping found on
      `/api/leads`); decide if that's the intended product shape or if it needs
      to become per-user

### Legal
- [ ] Draft ToS + Privacy Policy
- [ ] Get a real read on reselling scraped B2B contact data in target markets
- [ ] Add an opt-out path for people whose business info appears in the dataset

### Monetization
- [ ] Decide pricing model
- [ ] Integrate Stripe
- [ ] Gate exports/saved-searches by plan

### Product polish
- [ ] Build the missing `/reset-password` page (the "Forgot password?" link
      currently 404s)
- [ ] Add rate limiting to API routes
- [ ] Add basic usage analytics (who exports what) to inform pricing later
- [ ] Add failure alerting for the five GitHub Actions workflows

### Ops
- [ ] Confirm the Supabase plan's auth-user cap fits the beta size (14.8k rows
      is trivial for storage; this is about the user limit, not row count)
- [ ] Move off Vercel's Hobby tier before announcing anything publicly

## Related documents

- In-chat "Launch Readiness" report (HTML artifact, 2026-08-25) — the same
  content with real metric visualizations
- In-chat "Path to Launch" flowchart (HTML/SVG artifact, 2026-08-25) — the phase
  sequence above, drawn as a gated/parallel/merge diagram
- [knowledge.md](knowledge.md) — engineering session history and standing rules
  for this repo; read that before touching the scraper/CI side of this plan
