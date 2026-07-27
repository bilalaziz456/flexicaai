import type { NextConfig } from "next";

/**
 * Security response headers applied to every route. `microphone=(self)` is kept
 * enabled because the doctor voice scribe uses MediaRecorder; camera/geolocation are
 * off. HSTS is honoured only over HTTPS (ignored on http://localhost in dev). CSP is
 * intentionally NOT set here yet — it needs a nonce pass for the inline theme script +
 * Tailwind, so it's a separate, careful task (start report-only). See docs/scale-plan.md.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  experimental: {
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
