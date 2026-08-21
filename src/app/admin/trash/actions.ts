"use server";

import { revalidatePath } from "next/cache";
import { requireAdminCapability } from "@/core/auth/user";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { restoreGlobal, purgeGroup } from "@/core/trash";
import { allModuleTrash } from "@/config/module-trash";
import { logActivity } from "@/core/audit/log";

/**
 * Super-admin restore of a trashed group across any clinic (and the clinic row
 * itself). No retention limit — the super admin can restore items past the
 * clinic's window.
 */
export async function restoreTrashGlobal(
  group: string,
): Promise<{ ok: true } | { error: string }> {
  await requireAdminCapability("clinics:edit");
  if (!group) return { error: "Nothing to restore." };

  await restoreGlobal(group, allModuleTrash());

  await logActivity({
    action: "update",
    entity: "trash",
    clinicId: null,
    summary: "Restored an item from Trash (super admin)",
  });
  revalidatePath("/admin/trash");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * PERMANENT legal-erasure purge — the ONLY hard delete in the app. Super-admin
 * only, step-up password. Physically removes the group and everything under it.
 */
export async function purgeTrashGlobal(
  group: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  await requireAdminCapability("purge:delete");
  if (!group) return { error: "Nothing to purge." };
  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await purgeGroup(group, allModuleTrash());

  await logActivity({
    action: "delete",
    entity: "trash",
    clinicId: null,
    summary: "Permanently purged an item from Trash (legal erasure)",
  });
  revalidatePath("/admin/trash");
  return { ok: true };
}
