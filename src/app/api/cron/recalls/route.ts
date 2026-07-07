import { NextResponse } from "next/server";
import { processDueRecalls } from "@/core/recall";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/recalls — runs the recall engine: sends reminders for recalls
 * that are due. Triggered by Vercel Cron (CLAUDE.md §2 — start with Vercel Cron).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically; we also
 * accept ?token=<CRON_SECRET> for manual runs.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || url.searchParams.get("token") || "";

  if (serverEnv.CRON_SECRET) {
    if (provided !== serverEnv.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (isProduction) {
    // Refuse to run an unprotected cron in production.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const result = await processDueRecalls();
  return NextResponse.json({ ok: true, ...result });
}
