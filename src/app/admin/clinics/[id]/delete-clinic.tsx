"use client";

import { deleteClinic } from "@/app/admin/actions";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";

/**
 * Danger zone: permanently deletes the clinic and all its data (staff, patients,
 * appointments, visits, recalls). Requires re-entering the super admin's own
 * password in a modal — a deliberate step-up guard against accidental deletion.
 */
export function DeleteClinic({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete this clinic"
      triggerVariant="destructive"
      title={`Delete ${clinicName}`}
      description="This permanently deletes the clinic and ALL its data — staff, patients, appointments, visits and recalls. This cannot be undone."
      confirmLabel="Delete clinic"
      onConfirm={(password) => deleteClinic(clinicId, password)}
    />
  );
}
