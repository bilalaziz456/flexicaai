import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { formatPkr } from "@/core/appointments/fee";
import { getAppointmentBill } from "@/core/billing/bill";
import { getInvoiceForAppointment } from "@/core/billing/invoice";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";

/**
 * Deliver an appointment's invoice / bill summary to the patient over WhatsApp —
 * CORE (Finance). Template-based (no PDF host yet), so it sends the figures the
 * patient needs: invoice number/date, total, paid, outstanding. Clinic-scoped and
 * user-initiated (from the billing UI), so it RETURNS the outcome rather than
 * swallowing it — the caller shows success/failure. Records the attempt via the
 * standard channel (queue + audit) and no-ops gracefully when WhatsApp is unconfigured.
 *
 * Template params order (map these in the "invoice" campaign/template):
 * {{1}} patient, {{2}} clinic, {{3}} invoice ref (or date), {{4}} total,
 * {{5}} paid, {{6}} outstanding.
 */
export async function sendInvoiceWhatsApp(
  clinicId: string,
  appointmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      scheduledAt: appointments.scheduledAt,
      clinicName: clinics.name,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Appointment not found." };
  if (!row.patientPhone) return { ok: false, error: "This patient has no phone number." };

  const [bill, invoice] = await Promise.all([
    getAppointmentBill(clinicId, appointmentId),
    getInvoiceForAppointment(clinicId, appointmentId),
  ]);

  const when = row.scheduledAt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const ref = invoice?.label ?? when;
  const total = formatPkr(bill.billTotal);
  const paid = formatPkr(bill.collected);
  const outstanding = formatPkr(bill.outstanding);
  const body =
    `Invoice ${ref}: Total ${total}, Paid ${paid}, Outstanding ${outstanding}.\n${row.clinicName}`;

  const result = await sendWhatsAppToPatient({
    clinicId,
    patientId: row.patientId,
    phone: row.patientPhone,
    campaignName: serverEnv.AISENSY_INVOICE_CAMPAIGN,
    userName: row.patientName,
    templateParams: [row.patientName, row.clinicName, ref, total, paid, outstanding],
    body,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
