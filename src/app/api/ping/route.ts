import { NextResponse } from "next/server";

/**
 * GET /api/ping — a tiny, auth-free, DB-free reachability probe for the client
 * connectivity indicator (ConnectionStatus). Returns 200 fast; the client uses a
 * failed fetch (or a browser offline event) to show the "connection lost" bar.
 * `no-store` so a proxy/browser cache can't mask a real outage.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, t: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
