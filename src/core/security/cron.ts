import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * Cron authorization — CORE. Vercel Cron calls our job routes with
 * `Authorization: Bearer <CRON_SECRET>`; we also accept `?token=<CRON_SECRET>` (and
 * an `x-cron-token` header) so a job can be kicked off by hand.
 *
 * This block used to be copy-pasted, byte for byte, into all five cron routes. It
 * lives here once so the policy has ONE place to change and the five can't drift.
 *
 * Two rules it enforces:
 *   1. The comparison is CONSTANT-TIME. A plain `!==` bails at the first differing
 *      byte, so response latency leaks how long a prefix the caller guessed — enough
 *      to recover the secret byte by byte over many requests. We compare SHA-256
 *      digests, which are always 32 bytes, so `timingSafeEqual` never sees a length
 *      mismatch and never short-circuits. (Same care the WhatsApp Cloud webhook
 *      already takes over its X-Hub-Signature-256.)
 *   2. It FAILS CLOSED in production. With no CRON_SECRET configured, a deployed job
 *      route would be world-runnable, so we refuse to run it at all (503) rather than
 *      run it unprotected. Locally (no secret, not production) the job runs freely.
 */

/** Constant-time string equality via fixed-length digests. */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Guards a cron Route Handler. Returns a Response to send back when the caller is
 * NOT allowed to run the job, or `null` when it may proceed:
 *
 *   export async function GET(request: Request) {
 *     const denied = requireCron(request);
 *     if (denied) return denied;
 *     …
 *   }
 */
export function requireCron(request: Request): Response | null {
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided =
    bearer || request.headers.get("x-cron-token") || url.searchParams.get("token") || "";

  if (serverEnv.CRON_SECRET) {
    return secretEquals(provided, serverEnv.CRON_SECRET)
      ? null
      : NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Unconfigured: refuse to run an unprotected job in production; allow it in dev.
  return isProduction
    ? NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 })
    : null;
}
