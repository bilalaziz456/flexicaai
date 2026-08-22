import { NextResponse } from "next/server";
import { reportEvent } from "@/core/observability";

/**
 * CSP violation sink. Browsers POST here when a page violates the
 * `Content-Security-Policy` set by the proxy. No auth, no DB, host-agnostic.
 *
 * The policy is ENFORCED now (D-15), which makes this endpoint more important rather
 * than less: a refused script is a feature that silently does nothing, and the app
 * raises no error of its own to explain it. A report here is the only thing that
 * turns "a button stopped working" into a named directive and a URL.
 *
 * Its output should stay at ZERO (ADR-018). A recurring known violation trains people
 * to ignore the sink, so fix the page or the policy — never learn to live with it.
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
