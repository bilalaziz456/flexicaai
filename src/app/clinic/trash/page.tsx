import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { listClinicTrash } from "@/core/trash";
import { restoreTrashItem } from "./actions";
import { TrashTable } from "./trash-table";

/**
 * Clinic Trash — items this clinic deleted, within its retention window. Gated by
 * `trash:view`; Restore needs `trash:create`. Nothing is ever purged here (only
 * the super admin can), and items older than the window drop off this view but
 * stay in the database, visible to the super admin.
 */
export default async function ClinicTrashPage() {
  const user = await requireWorkspace("trash");
  const [clinic] = await db
    .select({ retention: clinics.trashRetentionDays })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const retention = clinic?.retention ?? 30;
  const items = await listClinicTrash(user.clinicId, retention);
  const canRestore = can(user, "trash", "create");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Deleted items are kept here for {retention} day{retention === 1 ? "" : "s"}.
          Restore brings an item — and anything deleted along with it — back.
        </p>
      </div>
      <TrashTable items={items} canRestore={canRestore} onRestore={restoreTrashItem} />
    </div>
  );
}
