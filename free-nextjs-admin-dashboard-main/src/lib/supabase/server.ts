import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side auth-aware client — used in Server Components and route
// handlers. Reads/writes the session cookie via next/headers, so
// supabase.auth.getUser() reflects the actual signed-in user.
export async function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

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
