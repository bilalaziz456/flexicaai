import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/constants";
import { THEME_SCRIPT } from "@/core/theme/theme-script";
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

/**
 * The root layout's inline theme script is allowed by HASH, not by the per-request
 * nonce. It has to be: the root layout is static (so the marketing pages can be
 * prerendered), and a prerendered page cannot carry a per-request value. The script
 * is a constant, so its hash is too — computed once, then cached for the process.
 */
let themeScriptHash: string | null = null;

async function getThemeScriptHash(): Promise<string> {
  if (themeScriptHash) return themeScriptHash;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(THEME_SCRIPT),
  );
  themeScriptHash = `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
  return themeScriptHash;
}

function cspReportOnly(nonce: string, scriptHash: string): string {
  // 'strict-dynamic' + nonce lets Next's chunk loader work without allow-listing hosts.
  // DEV also needs 'unsafe-eval' (HMR/React-refresh) — excluded in prod so real eval is
  // reported. Styles use 'unsafe-inline' (Tailwind + print <style>) — far lower risk than
  // scripts. media/blob covers MediaRecorder audio; img data/blob covers avatars/previews.
  return [
    `default-src 'self'`,
    // With 'strict-dynamic' the CSP3 spec makes host sources ('self') moot for scripts —
    // only the nonce and the hash actually admit anything.
    `script-src 'self' 'nonce-${nonce}' ${scriptHash} 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
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

export async function proxy(request: NextRequest) {
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
  // Correlation id for observability: minted here so ONE id spans the proxy and
  // everything the Node runtime does for this request. Node-side entry points pick it
  // up via `withRequestContext` (core/observability/context.ts) — ALS can't cross the
  // Edge→Node boundary, so a header is the only thing that can. An id supplied by an
  // upstream proxy/load balancer is honoured so traces join up end to end.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    cspReportOnly(nonce, await getThemeScriptHash()),
  );
  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
