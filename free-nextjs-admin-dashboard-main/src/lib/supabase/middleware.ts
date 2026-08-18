import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_DISABLED, DASHBOARD_PATH } from "@/lib/dev-auth";

const PROTECTED_PATHS = ["/", "/leads", "/saved-searches", "/my-leads"];
const AUTH_PATHS = ["/signin", "/signup"];

// Refreshes the session cookie on every request and enforces route
// protection: unauthenticated users are bounced to /signin, authenticated
// users are bounced away from the auth pages.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Auth off: nothing is gated, and the auth pages themselves redirect to the
  // dashboard so a bookmark or a stale link can't strand anyone on a login
  // screen. Returning early also skips the getUser() round trip on every
  // single request, which is pure latency when the answer can't matter.
  if (AUTH_DISABLED) {
    if (AUTH_PATHS.includes(request.nextUrl.pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = DASHBOARD_PATH;
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && PROTECTED_PATHS.includes(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/signin";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_PATHS.includes(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/leads";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
