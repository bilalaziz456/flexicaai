import { NextResponse } from "next/server";

/**
 * CSP violation sink (report-only pass). Browsers POST here when a page would violate
 * the `Content-Security-Policy-Report-Only` set by the proxy. We just LOG a compact line
 * per violation so we can tune the policy before enforcing — no auth, no DB, host-agnostic.
 * Best-effort: a malformed report never errors.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    // report-uri sends { "csp-report": {...} }; report-to sends an array of { body }.
    const r = (body["csp-report"] as Record<string, unknown>) ?? body;
    console.warn(
      "[csp-report]",
      JSON.stringify({
        directive: r["violated-directive"] ?? r["effective-directive"],
        blocked: r["blocked-uri"],
        doc: r["document-uri"],
        source: r["source-file"],
        line: r["line-number"],
      }),
    );
  } catch {
    // ignore unparseable reports
  }
  return new NextResponse(null, { status: 204 });
}
