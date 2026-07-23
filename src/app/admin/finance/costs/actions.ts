"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminCapability } from "@/core/auth/user";
import { setCostRates } from "@/core/admin/cost";
import { logActivity } from "@/core/audit/log";

export type CostRatesActionState = { error?: string; saved?: boolean };

// Non-negative money-ish numbers; unit costs are small decimals, FX is > 0 to matter.
const schema = z.object({
  scribeCallCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  whatsappMsgCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  whisperMinuteCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  claudeInputCost: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
  claudeOutputCost: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
  usdToPkr: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
});

/** Saves a new platform cost-rate version (Owner Finance, Phase 1). */
export async function saveCostRatesAction(
  _prev: CostRatesActionState,
  formData: FormData,
): Promise<CostRatesActionState> {
  const actor = await requireAdminCapability("serving_cost:edit");
  const parsed = schema.safeParse({
    scribeCallCost: formData.get("scribeCallCost"),
    whatsappMsgCost: formData.get("whatsappMsgCost"),
    whisperMinuteCost: formData.get("whisperMinuteCost"),
    claudeInputCost: formData.get("claudeInputCost"),
    claudeOutputCost: formData.get("claudeOutputCost"),
    usdToPkr: formData.get("usdToPkr"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await setCostRates(parsed.data, {
    id: actor.id,
    name: actor.fullName ?? actor.username,
  });
  await logActivity({
    action: "update",
    entity: "settings",
    summary: `Updated platform cost rates (Whisper $${parsed.data.whisperMinuteCost}/min · Claude $${parsed.data.claudeInputCost}/$${parsed.data.claudeOutputCost} per 1M · WhatsApp $${parsed.data.whatsappMsgCost} · FX ${parsed.data.usdToPkr})`,
  });
  revalidatePath("/admin/finance/costs");
  return { saved: true };
}
