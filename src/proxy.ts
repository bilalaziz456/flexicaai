import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/constants";
import { matchProtectedPrefix } from "@/core/types/auth";

/**
 * Coarse auth gate (Next.js 16 "proxy" convention). Runs in the EDGE runtime,
 * so it must stay free of Node-only code (no pg, no bcrypt, no DB). It only
 * checks whether a session cookie is PRESENT and bounces obviously-anonymous
 * visitors away from the panels — a fast UX guard, not the security boundary.
 *
 * The REAL authorization (validating the session against the DB and enforcing
 * role→panel access) happens server-side in `requireRole()` on each protected
 * page, which runs in the Node runtime and can query Postgres. Never rely on
 * this proxy alone for access control.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  const protectedMatch = matchProtectedPrefix(pathname);
  if (protectedMatch && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
