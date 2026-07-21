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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
