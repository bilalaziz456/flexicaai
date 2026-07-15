import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, invoices } from "@/core/db/schema";

/**
 * Invoices — CORE (Finance). One live invoice per appointment. The number is a
 * per-clinic sequential integer, allocated by locking the clinic row
 * (`SELECT … FOR UPDATE`) and bumping `next_invoice_no`, so two receptionists
 * issuing at once never collide. The bill amount is NOT stored — it's derived from
 * `computeBill` at render time (see core/billing/bill.ts).
 */

type Actor = { id: string; name: string };

export type IssuedInvoice = {
  id: string;
  invoiceNo: number;
  label: string; // prefix + number, e.g. "INV-42"
  issuedAt: Date;
};

/** The live invoice for an appointment, if one has been issued. */
export async function getInvoiceForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<IssuedInvoice | null> {
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNo: invoices.invoiceNo,
      issuedAt: invoices.issuedAt,
      prefix: clinics.invoicePrefix,
    })
    .from(invoices)
    .innerJoin(clinics, eq(clinics.id, invoices.clinicId))
    .where(
      byClinic(
        invoices.clinicId,
        clinicId,
        notDeleted(invoices.deletedAt),
        eq(invoices.appointmentId, appointmentId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    label: `${row.prefix ?? ""}${row.invoiceNo}`,
    issuedAt: row.issuedAt,
  };
}

/**
 * Issue (or return the existing) invoice for an appointment. Idempotent — a second
 * call returns the invoice already issued. Allocates the next per-clinic number
 * atomically. Clinic-scoped.
 */
export async function issueInvoice(
  clinicId: string,
  appointmentId: string,
  actor: Actor,
): Promise<{ error: string } | IssuedInvoice> {
  const existing = await getInvoiceForAppointment(clinicId, appointmentId);
  if (existing) return existing;

  const [appt] = await db
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt) return { error: "Appointment not found." };

  return db.transaction(async (tx) => {
    // Lock the clinic row so the number allocation serializes.
    const [c] = await tx
      .select({ next: clinics.nextInvoiceNo, prefix: clinics.invoicePrefix })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for("update")
      .limit(1);
    if (!c) return { error: "Clinic not found." };

    const allocated = c.next;
    await tx
      .update(clinics)
      .set({ nextInvoiceNo: allocated + 1, updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));

    const [inv] = await tx
      .insert(invoices)
      .values({
        clinicId,
        appointmentId,
        patientId: appt.patientId,
        invoiceNo: allocated,
        issuedBy: actor.id,
        issuedByName: actor.name,
      })
      .returning({ id: invoices.id, issuedAt: invoices.issuedAt });

    return {
      id: inv.id,
      invoiceNo: allocated,
      label: `${c.prefix ?? ""}${allocated}`,
      issuedAt: inv.issuedAt,
    };
  });
}
