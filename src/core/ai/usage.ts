import "server-only";

import { db } from "@/core/db";
import { aiUsage } from "@/core/db/schema";
import { getCostRates } from "@/core/admin/cost";
import type { ScribeUsage } from "@/core/ai/scribe-engine";

/**
 * AI usage metering — records the PAID calls of a scribe run for precise serving
 * cost (Owner Finance). One `whisper` row (audio seconds) + one `claude` row
 * (input/output tokens); each `cost_pkr` is SNAPSHOTTED at the rates live now, so a
 * later rate change never rewrites history. BEST-EFFORT — never throws / blocks the
 * scribe response (a metering hiccup must not fail a clinical note). See
 * `computeServingCost`, which sums these instead of the flat per-call estimate.
 */
export async function recordScribeUsage(args: {
  clinicId: string;
  visitId: string | null;
  usage: ScribeUsage;
}): Promise<void> {
  try {
    const rates = await getCostRates();
    const fx = rates.usdToPkr;
    const { audioSeconds, claude } = args.usage;

    const whisperUsd = (audioSeconds / 60) * rates.whisperMinuteCost;
    const claudeUsd =
      (claude.inputTokens / 1_000_000) * rates.claudeInputCost +
      (claude.outputTokens / 1_000_000) * rates.claudeOutputCost;

    await db.insert(aiUsage).values([
      {
        clinicId: args.clinicId,
        visitId: args.visitId,
        provider: "whisper",
        model: "whisper-1",
        audioSeconds: Math.round(audioSeconds),
        costPkr: Math.round(whisperUsd * fx),
      },
      {
        clinicId: args.clinicId,
        visitId: args.visitId,
        provider: "claude",
        model: claude.model,
        inputTokens: claude.inputTokens,
        outputTokens: claude.outputTokens,
        costPkr: Math.round(claudeUsd * fx),
      },
    ]);
  } catch {
    // Metering is best-effort; swallow so the scribe response is never blocked.
  }
}
