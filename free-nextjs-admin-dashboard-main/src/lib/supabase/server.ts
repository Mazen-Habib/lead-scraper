import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AUTH_DISABLED, DEV_USER_ID } from "@/lib/dev-auth";

// Server-side auth-aware client — used in Server Components and route
// handlers. Reads/writes the session cookie via next/headers, so
// supabase.auth.getUser() reflects the actual signed-in user.
//
// When AUTH_DISABLED, returns a service-role client instead. That is not a
// shortcut, it is a requirement: saved_searches / user_leads / scrape_runs are
// under RLS policies reading `auth.uid() = user_id` for role `authenticated`,
// so with no session the anon client sees an empty table and every insert is
// rejected. Only the service role can act for a user without their session.
//
// The service-role key is read from a NON-public env var, so it stays on the
// server and is never bundled into the browser payload.
export async function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  if (AUTH_DISABLED) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      // No cookie plumbing: there is no session to refresh, and this client
      // must not try to write auth cookies from a Server Component.
      return createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    // Falls through to the anon client. Reads of the public `leads` table still
    // work; the user-scoped tables will read as empty. getCurrentUserId still
    // returns DEV_USER_ID, so the failure mode is "no saved searches", not a
    // crash — see the console warning below.
    console.warn(
      "[dev-auth] AUTH_DISABLED but SUPABASE_SERVICE_ROLE_KEY is not set — " +
        "saved searches and saved leads will appear empty because RLS has no " +
        "session to match. Add it to .env.local."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component that can't set cookies —
          // fine as long as middleware.ts is refreshing the session.
        }
      },
    },
  });
}

type MinimalAuthClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
};

/**
 * Resolves the acting user id, or null when the request is genuinely
 * unauthenticated and auth is switched on.
 *
 * Route handlers used to inline `getUser()` and return 401 on a null user. With
 * auth disabled there is no user to find, so that check turned every
 * user-scoped endpoint into a 401 and the UI rendered as permanently broken.
 * This centralises the decision instead of repeating it in six handlers.
 *
 * A real session still wins when one exists, so switching auth back on needs no
 * further edits here.
 */
export async function getCurrentUserId(
  supabase: MinimalAuthClient
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user.id;
  return AUTH_DISABLED ? DEV_USER_ID : null;
}
