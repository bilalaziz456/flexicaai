"use server";

import { revalidatePath } from "next/cache";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { CHURN_DAYS_OPTIONS, setChurnInactiveDays } from "@/core/admin/company-settings";
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
