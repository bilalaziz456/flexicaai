import { requireRole } from "@/core/auth/user";
import { listAllTrash } from "@/core/trash";
import { TrashTable } from "@/app/clinic/trash/trash-table";
import { restoreTrashGlobal, purgeTrashGlobal } from "./actions";

/**
 * Super-admin Trash — every trashed item across ALL clinics, with no retention
 * limit (including items past a clinic's window and whole trashed clinics). The
 * super admin can Restore anything, or permanently Purge it for a legal-erasure
 * request (step-up password). Purge is the only hard delete in the app.
 */
export default async function AdminTrashPage() {
  await requireRole("super_admin");
  const items = await listAllTrash();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Everything deleted across all clinics — kept indefinitely. Restore brings
          an item back; Purge permanently erases it (legal requests only).
        </p>
      </div>
      <TrashTable
        items={items}
        canRestore
        showClinic
        onRestore={restoreTrashGlobal}
        onPurge={purgeTrashGlobal}
      />
    </div>
  );
}
