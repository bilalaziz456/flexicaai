import "server-only";
import { getAppointmentForDocument, getInvoiceForAppointment } from "@/core/billing/invoice";
import { getAppointmentBill } from "@/core/billing/bill";
import { getClinic } from "@/core/clinics/get-clinic";
import { formatPkr } from "@/core/appointments/fee";
import { formatDateTime12h } from "@/core/lib/date-time";
import { displayStaffName } from "@/core/types/auth";
import { appointmentWhatsAppText, invoiceWhatsAppText, whatsAppChatUrl } from "@/core/appointments/whatsapp-share";

/**
 * The "Send on WhatsApp" link for one appointment (owner, 2026-11-20): opens the
 * patient's chat in the person's own WhatsApp with the appointment — and, when
 * `withBill`, its bill — typed in. Clinic-scoped. Null when the appointment is gone.
 */
export async function appointmentWhatsAppLink(
  clinicId: string,
  appointmentId: string,
  withBill: boolean,
  /** "invoice" = the invoice page: the bill only, no appointment number or doctor. */
  kind: "appointment" | "invoice" = "appointment",
): Promise<string | null> {
  const [row, clinic] = await Promise.all([
    getAppointmentForDocument(clinicId, appointmentId),
    getClinic(clinicId),
  ]);
  if (!row) return null;
  let bill: { invoice: string | null; total: string; paid: string; due: string } | null = null;
  if (withBill) {
    const [b, invoice] = await Promise.all([
      getAppointmentBill(clinicId, appointmentId),
      getInvoiceForAppointment(clinicId, appointmentId),
    ]);
    if (b.billTotal > 0) {
      bill = {
        invoice: invoice && !invoice.voided ? invoice.label : null,
        total: formatPkr(b.billTotal),
        paid: formatPkr(b.collected),
        due: formatPkr(Math.max(0, b.outstanding)),
      };
    }
  }
  const contact = [clinic?.publicAddress, clinic?.whatsappDisplayNumber].filter(Boolean).join(" · ") || null;
  if (kind === "invoice" && bill) {
    return whatsAppChatUrl(
      row.patientPhone,
      invoiceWhatsAppText(
        { patientName: row.patientName, clinicName: clinic?.name ?? "the clinic", contact },
        { ...bill, date: formatDateTime12h(row.scheduledAt).split(",")[0] },
      ),
    );
  }
  const doctor =
    row.doctorName || row.doctorUsername
      ? displayStaffName(row.doctorPrefix, row.doctorName, row.doctorUsername ?? "")
      : null;
  const text = appointmentWhatsAppText({
    patientName: row.patientName,
    clinicName: clinic?.name ?? "the clinic",
    when: formatDateTime12h(row.scheduledAt),
    queueNumber: row.queueNumber,
    doctor,
    bill,
    contact,
  });
  return whatsAppChatUrl(row.patientPhone, text);
}
