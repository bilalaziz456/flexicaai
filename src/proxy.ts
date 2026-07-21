import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/constants";
import { matchProtectedPrefix } from "@/core/types/auth";

/**
 * Coarse auth gate + CSP nonce (Next.js 16 "proxy" convention). Runs in the EDGE
 * runtime, so it must stay free of Node-only code (no pg, no bcrypt, no DB). It:
 *   1. bounces obviously-anonymous visitors away from the panels (a fast UX guard —
 *      the REAL authorization is `requireRole()` server-side, never this proxy), and
 *   2. mints a per-request CSP nonce and attaches a **Content-Security-Policy-Report-Only**
 *      header. Report-only NEVER blocks — it only reports violations (to /api/csp-report)
 *      so we can tune the policy before enforcing. Host-agnostic (no server assumptions).
 */

/** A 128-bit base64 nonce (Web Crypto — available in the Edge runtime). */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const isDev = process.env.NODE_ENV !== "production";

function cspReportOnly(nonce: string): string {
  // 'strict-dynamic' + nonce lets Next's chunk loader work without allow-listing hosts.
  // DEV also needs 'unsafe-eval' (HMR/React-refresh) — excluded in prod so real eval is
  // reported. Styles use 'unsafe-inline' (Tailwind + print <style>) — far lower risk than
  // scripts. media/blob covers MediaRecorder audio; img data/blob covers avatars/previews.
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `report-uri /api/csp-report`,
  ].join("; ");
}

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

  // Per-request nonce: expose it to the app via a request header (components read it
  // for their inline scripts) and put it in the report-only CSP so Next nonces its own.
  const nonce = makeNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy-Report-Only", cspReportOnly(nonce));
  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
