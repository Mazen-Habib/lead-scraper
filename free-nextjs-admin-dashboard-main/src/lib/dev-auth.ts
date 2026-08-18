// Single switch for running the dashboard without a login.
//
// WHY THIS EXISTS: the sign-in flow was blocking all use of the app, and the
// "Forgot password?" link pointed at a /reset-password route that was never
// built — so a wrong password was an unrecoverable dead end. With auth off,
// every route opens straight onto the dashboard.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SECURITY: with auth disabled there is NO access control. Anyone who can │
// │ reach the app sees every lead and can write saved searches. This is a   │
// │ local-development posture, not a deployment one. Before putting this    │
// │ anywhere public, set NEXT_PUBLIC_DISABLE_AUTH=false and the original    │
// │ session gating comes back — nothing was deleted to make this work.      │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Default is ON (auth disabled) because that is the requested local posture.
// Opt back in with NEXT_PUBLIC_DISABLE_AUTH=false.
export const AUTH_DISABLED = process.env.NEXT_PUBLIC_DISABLE_AUTH !== "false";

// Where a "signed in" user lands. src/app/(admin)/page.tsx serves "/", so the
// dashboard IS the root route.
export const DASHBOARD_PATH = "/";

// saved_searches / user_leads / scrape_runs all declare
//   user_id uuid not null references auth.users(id)
// so the no-auth mode cannot invent an id — a random UUID violates the foreign
// key. It therefore borrows a REAL confirmed account. Override with DEV_USER_ID
// if you want the dev session to own a different user's rows.
//
// The default is the project's existing confirmed account, which also means the
// saved searches and saved leads you already had remain visible rather than the
// app looking empty.
export const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "f1e1d4db-dacb-4c79-a6f3-e1e9db6e2ca7";
