"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin, canManageTeam } from "@/core/auth/admin-permissions";
import { CHURN_DAYS_OPTIONS, setAnomalyThresholds, setChurnInactiveDays } from "@/core/admin/company-settings";
import { logActivity } from "@/core/audit/log";

export type OverviewActionState = { error?: string; saved?: boolean };

/**
 * Saves the COMPANY DEFAULT churn threshold (the value the Overview opens at for
 * everyone). A company-wide setting → restricted to full admins (owner/super_admin),
 * even though any `metrics:view` user may adjust the dropdown for their own view.
 */
export async function setChurnDefaultAction(days: number): Promise<OverviewActionState> {
  const user = await requireAdminCapability("metrics:view");
  if (!canManageTeam(user)) return { error: "Only a full admin can set the company default." };
  if (!(CHURN_DAYS_OPTIONS as readonly number[]).includes(days)) return { error: "Invalid threshold." };

  await setChurnInactiveDays(days);
  await logActivity({ action: "update", entity: "settings", clinicId: null, summary: `Set company churn threshold default to ${days} days` });
  revalidatePath("/admin/overview");
  return { saved: true };
}

const anomalySchema = z.object({
  thinMarginPct: z.coerce.number().int().min(1, "1–100%.").max(100, "1–100%."),
  spikeMultiple: z.coerce.number().int().min(2, "At least 2×.").max(100),
  spikeFloorPkr: z.coerce.number().int().min(0).max(10_000_000),
});

/**
 * Saves the company usage/cost anomaly-flag thresholds. Full-admin only (company
 * policy), and only meaningful to someone who can see the cost side (`revenue:view`).
 */
export async function setAnomalyThresholdsAction(
  _prev: OverviewActionState,
  formData: FormData,
): Promise<OverviewActionState> {
  const user = await requireAdminCapability("metrics:view");
  if (!canManageTeam(user) || !canAdmin(user, "revenue:view")) {
    return { error: "Only a full admin with revenue access can set flag rules." };
  }
  const parsed = anomalySchema.safeParse({
    thinMarginPct: formData.get("thinMarginPct"),
    spikeMultiple: formData.get("spikeMultiple"),
    spikeFloorPkr: formData.get("spikeFloorPkr"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await setAnomalyThresholds(parsed.data);
  await logActivity({
    action: "update",
    entity: "settings",
    clinicId: null,
    summary: `Set anomaly flag rules (high cost ≥ ${parsed.data.thinMarginPct}% · spike ≥ ${parsed.data.spikeMultiple}× · floor Rs ${parsed.data.spikeFloorPkr})`,
  });
  revalidatePath("/admin/overview");
  return { saved: true };
}
