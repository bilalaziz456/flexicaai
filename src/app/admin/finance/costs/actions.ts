"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { setCostRates } from "@/core/admin/cost";
import { logActivity } from "@/core/audit/log";

export type CostRatesActionState = { error?: string; saved?: boolean };

// Non-negative money-ish numbers; unit costs are small decimals, FX is > 0 to matter.
const pct = z.coerce.number().min(0, "Tax % must be ≥ 0.").max(100, "Tax % can't exceed 100.");
const schema = z.object({
  scribeCallCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  whatsappMsgCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  whisperMinuteCost: z.coerce.number().min(0, "Must be ≥ 0.").max(1000),
  claudeInputCost: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
  claudeOutputCost: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
  usdToPkr: z.coerce.number().min(0, "Must be ≥ 0.").max(100000),
  // International-transaction bank tax/charges — itemised or a single total.
  taxMode: z.enum(["itemized", "total"]).default("itemized"),
  foreignTxnFeePct: pct.default(0),
  fedPct: pct.default(0),
  advanceTaxPct: pct.default(0),
  additionalTaxPct: pct.default(0),
  totalTaxPct: pct.default(0),
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
    taxMode: formData.get("taxMode") ?? "itemized",
    foreignTxnFeePct: formData.get("foreignTxnFeePct") ?? 0,
    fedPct: formData.get("fedPct") ?? 0,
    advanceTaxPct: formData.get("advanceTaxPct") ?? 0,
    additionalTaxPct: formData.get("additionalTaxPct") ?? 0,
    totalTaxPct: formData.get("totalTaxPct") ?? 0,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await setCostRates(parsed.data, {
    id: actor.id,
    name: actor.fullName ?? actor.username,
  });
  const eff =
    parsed.data.taxMode === "total"
      ? parsed.data.totalTaxPct
      : parsed.data.foreignTxnFeePct + parsed.data.fedPct + parsed.data.advanceTaxPct + parsed.data.additionalTaxPct;
  await logActivity({
    action: "update",
    entity: "settings",
    summary: `Updated platform cost rates (Whisper $${parsed.data.whisperMinuteCost}/min · Claude $${parsed.data.claudeInputCost}/$${parsed.data.claudeOutputCost} per 1M · WhatsApp $${parsed.data.whatsappMsgCost} · FX ${parsed.data.usdToPkr} · bank tax ${eff}% [${parsed.data.taxMode}])`,
  });
  revalidatePath("/admin/finance/costs");
  return { saved: true };
}
