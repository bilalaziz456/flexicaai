import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, invoices } from "@/core/db/schema";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import { getInvoiceForAppointment } from "@/core/billing/invoice";

type Actor = { id: string; name: string };

/**
 * Deletes an invoice from the Invoices page (owner's call, 2026-10-12). The caller
 * has already re-checked the person's password.
 *
 * NOTHING IS REMOVED. The invoice is VOIDED and stamped with who did it, when and
 * why, so its number is never reused and it stays on the register, marked Deleted —
 * an invoice series with a hole in it is the first thing an auditor asks about. Its
 * visit is CANCELLED (without messaging the patient: this is an office correction),
 * which also takes it out of sales and doctor shares.
 *
 * REFUSED WHILE MONEY IS HELD. Deleting the paper while the cash stays recorded would
 * leave the day book, the drawer and the patient's balance pointing at an invoice
 * that says it never happened. Refund first, then delete — both are then on record.
 *
 * Kept out of `invoice.ts` because it needs `set-status`, which itself imports
 * `invoice.ts`.
 */
export async function deleteInvoice(
  clinicId: string,
  appointmentId: string,
  actor: Actor,
  reason: string | null,
): Promise<{ error: string } | { ok: true; label: string }> {
  const invoice = await getInvoiceForAppointment(clinicId, appointmentId);
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.deleted) return { error: `${invoice.label} is already deleted.` };

  const [appt] = await db
    .select({ status: appointments.status, collected: appointments.amountCollected })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), eq(appointments.id, appointmentId)))
    .limit(1);
  if (!appt) return { error: "Invoice not found." };
  if (appt.collected > 0) {
    return {
      error: `Rs ${appt.collected.toLocaleString("en-PK")} has been received on ${invoice.label}. Refund it first, then delete the invoice.`,
    };
  }

  // Cancel the visit first: that voids the invoice automatically ("Cancelled"),
  // and the stamp below then turns the void into a deletion.
  if (appt.status !== "cancelled" && appt.status !== "no_show") {
    await applyAppointmentStatus(clinicId, appointmentId, "cancelled", { notify: false });
  }
  await db
    .update(invoices)
    .set({
      voidedAt: new Date(),
      voidedBy: actor.id,
      voidedByName: actor.name,
      voidReason: reason?.trim().slice(0, 300) || "Deleted",
    })
    .where(byClinic(invoices.clinicId, clinicId, eq(invoices.id, invoice.id)));
  return { ok: true, label: invoice.label };
}
