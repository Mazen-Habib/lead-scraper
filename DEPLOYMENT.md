# Deploying the Leads Dashboard (Vercel + Supabase)

The dashboard is a Next.js app in **`free-nextjs-admin-dashboard-main/`**. It reads leads
from Supabase (read-only, anon key). The scraper writes to Supabase separately using the
service-role key. This guide gets both live.

> **What I (Claude) can't do for you:** log into Vercel/Supabase, create accounts, or handle
> secret keys. Those steps are marked **[you]**. Everything else (configs, build, migration
> file) is already prepared in the repo.

---

## Part 1 — Supabase (the database)

The project is already referenced at `https://jvtxbkfpvqyjunwbtzza.supabase.co`. Confirm it
exists and the `leads` table is created.

1. **[you]** Open <https://supabase.com/dashboard> → your project (or create one if that URL
   is dead).
2. **[you] Apply the table migration.** In the Supabase dashboard → **SQL Editor** → paste the
   full contents of [`supabase/migrations/0001_create_leads.sql`](supabase/migrations/0001_create_leads.sql)
   → **Run**. This creates the `leads` table, indexes, the `updated_at` trigger, and the RLS
   policy that lets the dashboard read with the anon key.
3. **[you] Grab your keys** from **Project Settings → API**:
   - `Project URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` / `publishable` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe for the browser; RLS
     limits it to read-only)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**secret — server-side only, never in
     the frontend**)

---

## Part 2 — Populate the table

The dashboard shows nothing until `leads` has rows. Two ways to fill it:

- **From the scraper (ongoing):** create a local `.env` at the repo root (copy `.env.example`)
  with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run `npm run scrape`. It upserts the
  deduped master list to Supabase at the end (`src/lib/pushToSupabase.js`).
- **One-off backfill of existing CSVs:** with the same `.env` set,
  `node scripts/backfill-supabase.js output/leads-master.csv` re-scores and upserts what you
  already have.

> The weekly GitHub Action (`.github/workflows/weekly-scrape.yml`) can also do this on a
> schedule — it needs `SUPABASE_SERVICE_ROLE_KEY` added as a **GitHub repo secret**.

---

## Part 3 — Vercel (the frontend)

The Next.js app is **not** at the repo root, so the Root Directory setting is the one thing
that trips people up.

### Option A — Vercel dashboard (recommended, no CLI)

1. **[you]** <https://vercel.com/new> → **Import** the `Mazen-Habib/lead-scraper` GitHub repo.
2. **[you] Set Root Directory** = `free-nextjs-admin-dashboard-main`
   (Vercel → project → **Settings → Build & Deployment → Root Directory**). Framework
   auto-detects as **Next.js**.
3. **[you] Add Environment Variables** (Settings → Environment Variables), for all
   environments:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
4. **[you] Deploy.** Vercel builds only that subdirectory and gives you a `*.vercel.app` URL.

### Option B — Vercel CLI

```bash
npm i -g vercel
cd free-nextjs-admin-dashboard-main
vercel            # first run links the project (interactive login)
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```

Run from inside `free-nextjs-admin-dashboard-main/` so the CLI treats it as the project root.

---

## Notes & gotchas

- **`vercel.json`** in the FE dir was cleaned up — it no longer uses the deprecated
  `@secret` env references that fail with "Secret does not exist". Env vars now come from the
  Vercel project settings (Part 3, step 3).
- **Only the two `NEXT_PUBLIC_*` vars go in Vercel.** The `service_role` key must **never** be
  added to the Vercel frontend project — it would be exposed to browsers. It belongs only in
  the scraper's local `.env` / GitHub Actions secret.
- **Fallbacks:** if the Supabase env vars are unset, the dashboard falls back to a local CSV
  (`LOCAL_CSV_PATH`) or GitHub raw CSV — but Supabase is the intended production path.
- **Repo size:** the repo also contains vendored `Scrapegraph-ai-main/` and the Node scraper.
  Vercel clones the whole repo but only builds the FE subdir, so it works — just a slower clone.
  Consider removing `Scrapegraph-ai-main/` from git to slim it down.
- **Scrapling (stealth-fetch fallback for TechBehemoths/SelectedFirms):** one-time local setup —
  `pip install "scrapling[fetchers]"` then `scrapling install` (downloads the Camoufox browser
  binary, no API key needed). Already wired into both GitHub Actions workflows next to the
  ScrapegraphAI install step. `Scrapling-main/` in the repo root is a local reference copy of the
  library only — it's gitignored, not shipped; the real dependency comes from PyPI.
- **Local preview before deploy:** `cd free-nextjs-admin-dashboard-main && npm run dev`, then
  create `.env.local` there with the two `NEXT_PUBLIC_*` vars to test against Supabase.
