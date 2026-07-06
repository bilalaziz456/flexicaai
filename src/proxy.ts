import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/core/auth/update-session";
import {
  ROLE_HOME_ROUTE,
  matchProtectedPrefix,
} from "@/core/types/auth";

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Global auth gate (Next.js 16 "proxy" convention — formerly middleware).
 * Runs on every request (see matcher below):
 *  1. Refreshes the Supabase session cookie.
 *  2. Blocks unauthenticated users from the four panels.
 *  3. Enforces role→panel access (a receptionist cannot open /admin).
 *  4. Bounces already-authenticated users away from /login and /signup.
 *
 * CORE and specialty-agnostic: it authorizes by ROLE only. It never inspects
 * which modules a clinic has enabled — that gating happens inside each panel.
 */
export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const protectedMatch = matchProtectedPrefix(pathname);

  if (protectedMatch) {
    if (!user) {
      return redirectWithCookies(request, response, "/login", {
        redirectTo: pathname,
      });
    }
    if (!role) {
      // Authenticated but no role assigned yet (admin hasn't provisioned them).
      return redirectWithCookies(request, response, "/login", {
        error: "no_access",
      });
    }
    if (!protectedMatch.roles.includes(role)) {
      // Logged in, wrong panel — send them to their own.
      return redirectWithCookies(request, response, ROLE_HOME_ROUTE[role]);
    }
  }

  if (AUTH_PAGES.includes(pathname) && user && role) {
    return redirectWithCookies(request, response, ROLE_HOME_ROUTE[role]);
  }

  return response;
}

/**
 * Redirects while preserving any refreshed session cookies from updateSession.
 * Dropping these cookies would silently log the user out on redirect.
 */
function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  path: string,
  query?: Record<string, string>,
) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
