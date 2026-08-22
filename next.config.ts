import type { NextConfig } from "next";

/**
 * Security response headers applied to every route. `microphone=(self)` is kept
 * enabled because the doctor voice scribe uses MediaRecorder; camera/geolocation are
 * off. HSTS is honoured only over HTTPS (ignored on http://localhost in dev).
 *
 * CSP is deliberately NOT here: it is set per-request in `src/proxy.ts`, because its
 * `script-src` depends on whether the response is server-rendered (a nonce) or
 * prerendered (it cannot be). A static header could only express one of the two.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

/**
 * Hostnames allowed to invoke Server Actions.
 *
 * Every mutation in this app is a Server Action, and Next guards them with a CSRF
 * check that compares the request's `Origin` against its `Host` / `X-Forwarded-Host`.
 * Behind nginx those can legitimately differ, and the symptom is nasty to diagnose
 * because it looks like nothing is wrong: the app renders perfectly, and every single
 * save is silently rejected.
 *
 * Derived from `APP_URL` rather than hardcoded, so the production domain is declared
 * in exactly ONE place (the env file) instead of drifting between there and here.
 *
 * Returns [] for localhost or an unset/unparseable value — Next's own same-origin
 * check already covers local development, and an empty list leaves it untouched. Both
 * `hostname` and `host` are listed because a proxy may or may not present the port.
 */
function serverActionOrigins(): string[] {
  const raw = process.env.APP_URL;
  if (!raw) return [];
  try {
    const { hostname, host } = new URL(raw);
    if (hostname === "localhost" || hostname === "127.0.0.1") return [];
    return [...new Set([hostname, host])];
  } catch {
    // A malformed APP_URL is env.ts's problem to report, not the build's to crash on.
    return [];
  }
}

const allowedOrigins = serverActionOrigins();

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  experimental: {
    // Omitted entirely when empty, so local dev keeps Next's default behaviour.
    ...(allowedOrigins.length ? { serverActions: { allowedOrigins } } : {}),
    // WHY: in `next dev`, opening a dynamic-segment route ([id]/[slug] — staff
    // profiles, appointment/patient details, any dynamic list) makes Next fork a
    // separate "static-paths" Node child process to load that page's full server
    // module graph (db pool, schema, Anthropic SDK, pdf-lib…) just to look for
    // generateStaticParams. On Windows that cold fork is fragile and dies under
    // memory pressure, surfacing as "Jest worker encountered N child process
    // exceptions, exceeding retry limit". Running the worker as a THREAD (shares
    // the parent heap, no cold fork) removes the crash; all our deps are pure JS
    // (pg/bcryptjs/pdf-lib/nodemailer) so worker_threads is safe.
    workerThreads: true,
    // WHY: don't preload every page's modules into memory at server start — keeps
    // the baseline footprint low so the worker has headroom. (Next dev-memory doc.)
    preloadEntriesOnStart: false,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
