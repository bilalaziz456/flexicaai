"use client";

import { Trash2 } from "lucide-react";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { deleteInvoiceAction } from "@/app/clinic/invoices/actions";

/**
 * Delete an invoice: asks why, and for the person's own password (re-checked on the
 * server). The invoice is voided and stays on the register, marked Deleted, and its
 * visit is cancelled. Refused while money is held — `held` says how much, so the
 * reason is visible before anyone types a password.
 */
export function DeleteInvoiceButton({
  appointmentId,
  label,
  held,
  compact = false,
}: {
  appointmentId: string;
  label: string;
  /** Money still held on the invoice (collected, net of refunds). */
  held: number;
  compact?: boolean;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete"
      triggerIcon={compact ? <Trash2 className="size-3.5" aria-hidden="true" /> : undefined}
      triggerVariant={compact ? "ghost" : "destructive"}
      title={`Delete invoice ${label}?`}
      description="The invoice is kept on the register marked Deleted (its number is never reused), and its visit is cancelled. The patient is not messaged."
      warning={
        held > 0
          ? `Rs ${held.toLocaleString("en-PK")} has been received on this invoice. Refund it first — the delete will be refused until then.`
          : undefined
      }
      reasonField={{ label: "Reason", placeholder: "e.g. entered twice, wrong patient" }}
      confirmLabel="Delete invoice"
      onConfirm={(password, reason) => deleteInvoiceAction(appointmentId, password, reason)}
    />
  );
}
