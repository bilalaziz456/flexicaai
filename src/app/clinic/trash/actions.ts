"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/user";
import { restoreForClinic } from "@/core/trash";
import { logActivity } from "@/core/audit/log";

/**
 * Restores a trashed item (and everything its deletion cascade-hid) back to the
 * clinic. Gated by `trash:create` (the "Restore" capability). Clinic-scoped — only
 * this clinic's rows in the group are reverted.
 */
export async function restoreTrashItem(
  group: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireWorkspace("trash", "create");
  if (!group) return { error: "Nothing to restore." };

  await restoreForClinic(user.clinicId, group);

  await logActivity({
    action: "update",
    entity: "trash",
    summary: "Restored an item from Trash",
  });
  // A restore can bring back any kind of record — refresh the whole workspace.
  revalidatePath("/clinic", "layout");
  return { ok: true };
}
