import { NextResponse } from "next/server";
import { recoverStalledScribes } from "@/core/ai/scribe-job";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/scribe-recover — marks scribe runs the process died in the middle of
 * as failed, so the doctor can retry them (delta D-08 / ADR-020).
 *
 * The async scribe's one real cost: the work is no longer tied to a request, so if the
 * node restarts mid-run nothing retries it and the visit sits in `transcribing`
 * forever with a stored recording and a billed API call behind it. Nobody would ever
 * be told. This is what goes looking.
 *
 * It does NOT re-run them — see `recoverStalledScribes` for why spending money on a
 * provider unasked is the worse failure.
 */
export async function GET(request: Request) {
  return runCron(request, "cron.scribeRecover", async () => {
    const result = await recoverStalledScribes();
    return NextResponse.json({ ok: true, ...result });
  });
}
