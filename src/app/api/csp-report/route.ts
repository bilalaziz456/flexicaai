import { NextResponse } from "next/server";
import { reportEvent } from "@/core/observability";

/**
 * CSP violation sink (report-only pass). Browsers POST here when a page would violate
 * the `Content-Security-Policy-Report-Only` set by the proxy. Each violation goes to
 * the observability sink so the policy can be tuned before it is ENFORCED — that
 * tuning is the whole reason the CSP is still report-only, and it needs the reports
 * to be somewhere an operator will actually look. No auth, no DB, host-agnostic.
 *
 * This endpoint is public and browser-driven, so the payload is untrusted: it goes
 * through `extra`, which is deep-redacted (a document-uri can carry query values).
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    // report-uri sends { "csp-report": {...} }; report-to sends an array of { body }.
    const r = (body["csp-report"] as Record<string, unknown>) ?? body;
    const directive = r["violated-directive"] ?? r["effective-directive"];
    reportEvent(`CSP violation: ${String(directive ?? "unknown")}`, {
      op: "security.cspViolation",
      severity: "warn",
      extra: {
        directive,
        blocked: r["blocked-uri"],
        doc: r["document-uri"],
        source: r["source-file"],
        line: r["line-number"],
      },
    });
  } catch {
    // Unparseable report from a browser — nothing actionable, and reporting a
    // malformed report would just be noise on a public endpoint.
  }
  return new NextResponse(null, { status: 204 });
}
