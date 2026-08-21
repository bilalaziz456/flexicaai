import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv, isProduction } from "@/core/lib/env";
import { report, reportEvent, withRequestContext } from "@/core/observability";

/**
 * Cron authorization — CORE. The job routes are invoked by SYSTEM CRON / systemd
 * timers on the server (CLAUDE.md §2a) with `Authorization: Bearer <CRON_SECRET>`;
 * we also accept `?token=<CRON_SECRET>` and an `x-cron-token` header so a job can be
 * kicked off by hand.
 *
 * DEPLOY NOTE: nothing schedules these for us. There is no platform cron on a
 * self-managed server, so if the crontab/timers are not installed, recalls and
 * reminders never fire and NOTHING reports it — a job that is never invoked produces
 * no error to report. `vercel.json` is inert; it survives only as the reference list
 * of paths and schedules. Example (`/etc/cron.d/flexicaai`, times mirror vercel.json):
 *
 *   0 9  * * *  flexica  curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/recalls
 *   0 18 * * *  flexica  curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/reminders
 *
 * Call the LOCAL port directly so a job never traverses nginx (no proxy timeout, no
 * TLS, and it keeps the secret off the public interface).
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
/**
 * Runs an authorized cron job inside a request context and reports a crash.
 *
 * A cron has no user watching it: if the nightly reminder sweep throws, the only
 * symptom is patients quietly not being reminded. So the job body is wrapped once,
 * here, rather than each route growing its own try/catch — and the correlation id
 * ties every `report()` the job emits back to the run that produced it.
 *
 *   export async function GET(request: Request) {
 *     return runCron(request, "cron.reminders", async () => {
 *       const result = await sendDueAppointmentReminders();
 *       return NextResponse.json({ ok: true, ...result });
 *     });
 *   }
 */
export async function runCron(
  request: Request,
  entry: string,
  job: () => Promise<Response>,
): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;
  return withRequestContext(entry, request, async () => {
    const startedAt = Date.now();
    try {
      const res = await job();
      reportEvent("cron completed", {
        op: entry,
        severity: "info",
        extra: { ms: Date.now() - startedAt },
      });
      return res;
    } catch (e) {
      // Unlike the rest of the app, a cron failure has no user-visible surface at
      // all — this report IS the alarm.
      report(e, { op: entry, extra: { ms: Date.now() - startedAt } });
      return NextResponse.json({ error: "Job failed." }, { status: 500 });
    }
  });
}

/** The auth check on its own, for a route that wants to own its response shape. */
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
