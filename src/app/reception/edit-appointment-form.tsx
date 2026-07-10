"use client";

import { Trash2 } from "lucide-react";
import { deleteAppointment } from "./actions";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";

/** Delete an appointment (step-up password), then return to the list. */
export function DeleteAppointmentButton({
  appointmentId,
}: {
  appointmentId: string;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete appointment"
      triggerVariant="destructive"
      triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
      title="Delete appointment"
      description="Permanently delete this appointment. To just call it off, use Cancel instead."
      onConfirm={(password) => deleteAppointment(appointmentId, password)}
    />
  );
}
