"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import {
  RETENTION_DAYS_OPTIONS,
  setActivityLogRetentionDays,
} from "@/core/admin/company-settings";
import { logActivity } from "@/core/audit/log";

export type LogsActionState = { error?: string; saved?: boolean };

/**
 * Sets how long `activity_logs` rows are kept (delta D-11). Company-wide, and it
 * governs the deletion of an audit trail over patient data — so it is restricted to a
 * FULL admin, not merely someone who can read the logs.
 *
 * The change is itself audit-logged, which matters more here than almost anywhere
 * else: "who shortened the retention window, and when" is exactly the question that
 * gets asked after evidence turns out to be missing.
 */
export async function setLogRetentionAction(days: number): Promise<LogsActionState> {
  // Same guard the page itself uses (there is no `logs` admin capability — the whole
  // platform log is super-admin-only), narrowed further to a FULL admin below.
  const user = await requireRole("super_admin");
  if (!canManageTeam(user)) {
    return { error: "Only a full admin can change log retention." };
  }
  if (!(RETENTION_DAYS_OPTIONS as readonly number[]).includes(days)) {
    return { error: "Invalid retention window." };
  }

  await setActivityLogRetentionDays(days);
  await logActivity({
    action: "update",
    entity: "settings",
    clinicId: null,
    summary:
      days === 0
        ? "Set activity-log retention to keep everything"
        : `Set activity-log retention to ${days} days`,
  });
  revalidatePath("/admin/logs");
  return { saved: true };
}
