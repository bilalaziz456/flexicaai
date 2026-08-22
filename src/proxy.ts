import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/constants";
import { THEME_SCRIPT } from "@/core/theme/theme-script";
import { matchProtectedPrefix } from "@/core/types/auth";

/**
 * Coarse auth gate + CSP (Next.js 16 "proxy" convention). Runs in the EDGE runtime,
 * so it must stay free of Node-only code (no pg, no bcrypt, no DB). It:
 *   1. bounces obviously-anonymous visitors away from the panels (a fast UX guard —
 *      the REAL authorization is `requireRole()` server-side, never this proxy), and
 *   2. attaches an **enforced** Content-Security-Policy, in one of two strengths.
 *
 * Two policies, because a nonce and a prerendered page are mutually exclusive — see
 * `scriptSrc` below. Everything OUTSIDE `script-src` is identical and enforced on
 * every response.
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

/**
 * Everything except `script-src`. Identical for both policies and enforced on every
 * response — these are the directives that cost nothing and were previously advisory:
 * `connect-src` bounds where a script could ship patient data, `form-action` where a
 * form could post it, `frame-ancestors` stops clickjacking and `base-uri` stops a
 * `<base>` tag re-pointing every relative script URL.
 *
 * Styles keep 'unsafe-inline' — Tailwind and the print `<style>` blocks need it, and
 * an injected STYLE is a far smaller prize than an injected script.
 * media/blob covers MediaRecorder audio; img data/blob covers avatars and previews.
 */
const COMMON_DIRECTIVES = [
  `default-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  `media-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  // Kept on the ENFORCED policy deliberately: a directive with teeth still has to say
  // when it bit something, or a broken page is a mystery instead of a log line.
  `report-uri /api/csp-report`,
];

/**
 * `script-src`, in the only two shapes that actually work here.
 *
 * **A nonce and a PRERENDERED page are mutually exclusive.** Next applies nonces
 * during server rendering, from the request; a page generated at build time has no
 * request, so its ~13 chunk tags and ~36 inline flight scripts carry none. Under
 * 'strict-dynamic' the host-source 'self' is ignored, so all of them are refused —
 * measured, not assumed: enforcing the strict policy blanked every script on
 * `/privacy` AND on any 404, since `/_not-found` is prerendered too and any path can
 * reach it. Next's own docs say the same thing: nonces require that EVERY page be
 * dynamically rendered.
 *
 * So the strength is chosen by `matchProtectedPrefix` — the predicate that already
 * defines "this is a panel", which is why this needs no second list to drift:
 *
 * - **Panels** (`/admin`, `/clinic`) are dynamic by construction — every page reads
 *   the session — so they get the strict, nonce + 'strict-dynamic' policy. That is
 *   the whole patient-data surface, and it is where a strict script-src is worth
 *   most. Verified clean across the workspace.
 * - **Everything else** is public and may be prerendered, so it gets 'unsafe-inline'.
 *   Those pages render no user input at all, so the XSS surface they trade away is
 *   close to nil, while 'self' still refuses any third-party script.
 *
 * The public policy must carry NEITHER the nonce NOR the theme hash: under CSP3 the
 * presence of either DISABLES 'unsafe-inline', which would put us straight back to a
 * blank page. Adding the hash "for good measure" is the tempting mistake here.
 */
function scriptSrc(strict: false): string;
function scriptSrc(strict: true, nonce: string, scriptHash: string): string;
function scriptSrc(strict: boolean, nonce?: string, scriptHash?: string): string {
  // DEV also needs 'unsafe-eval' (HMR / React refresh) — excluded in prod so a real
  // eval is refused there.
  const dev = isDev ? " 'unsafe-eval'" : "";
  return strict
    ? `script-src 'self' 'nonce-${nonce}' ${scriptHash} 'strict-dynamic'${dev}`
    : `script-src 'self' 'unsafe-inline'${dev}`;
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

  const requestHeaders = new Headers(request.headers);
  // Correlation id for observability: minted here so ONE id spans the proxy and
  // everything the Node runtime does for this request. Node-side entry points pick it
  // up via `withRequestContext` (core/observability/context.ts) — ALS can't cross the
  // Edge→Node boundary, so a header is the only thing that can. An id supplied by an
  // upstream proxy/load balancer is honoured so traces join up end to end.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  // Only a panel response gets a nonce, because only a panel response is guaranteed
  // to be server-rendered. Setting it elsewhere would just decorate tags that no
  // policy references — and on a prerendered page it cannot be applied at all.
  let policy: string;
  if (protectedMatch) {
    const nonce = makeNonce();
    // Next reads this to nonce its own framework scripts, chunks and inline styles.
    requestHeaders.set("x-nonce", nonce);
    policy = [scriptSrc(true, nonce, await getThemeScriptHash()), ...COMMON_DIRECTIVES].join("; ");
  } else {
    policy = [scriptSrc(false), ...COMMON_DIRECTIVES].join("; ");
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
