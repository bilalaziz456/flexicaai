import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getAppointmentProcedureItems } from "@/core/appointments/procedures";
import { getAppointmentBill } from "@/core/billing/bill";
import { getInvoiceForAppointment } from "@/core/billing/invoice";
import {
  computeBill,
  effectiveDiscountValue,
  formatPkr,
  normalizeDiscountType,
} from "@/core/appointments/fee";
import { displayStaffName } from "@/core/types/auth";
import { formatMrn } from "@/core/patients/mrn";
import { InvoicePrintFrame } from "@/app/reception/invoice-print";

/**
 * Printable invoice for an appointment (Finance). Thermal / A5 / A4 via the print
 * frame. Shows the clinic header, patient, line items (consultation + procedures),
 * discount, total, and paid/outstanding. Gated by the sales feature + billing:view.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const { id } = await params;

  const [row] = await db
    .select({
      status: appointments.status,
      scheduledAt: appointments.scheduledAt,
      queueNumber: appointments.queueNumber,
      chargeConsultation: appointments.chargeConsultation,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      patientMrn: patients.mrn,
      patientCreatedAt: patients.createdAt,
      doctorPrefix: users.prefix,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorFee: users.consultationFee,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, id),
      ),
    )
    .limit(1);
  if (!row) notFound();

  const [clinic] = await db
    .select({
      name: clinics.name,
      featuresEnabled: clinics.featuresEnabled,
      invoicePaper: clinics.invoicePaper,
      signature: clinics.whatsappSignature,
      mrnPrefix: clinics.mrnPrefix,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales") || !can(user, "billing", "view")) {
    notFound();
  }
  const mrnLabel = formatMrn(clinic?.mrnPrefix, row.patientMrn, row.patientCreatedAt);

  const [items, aBill, invoice] = await Promise.all([
    getAppointmentProcedureItems(clinicId, id),
    getAppointmentBill(clinicId, id),
    getInvoiceForAppointment(clinicId, id),
  ]);

  const discountType = normalizeDiscountType(row.discountType);
  const doctorFee = row.chargeConsultation ? (row.doctorFee ?? 0) : 0;
  const bill = computeBill(
    doctorFee,
    items.map((i) => ({
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      discountType: i.discountType,
      discountValue: i.discountValue,
    })),
    discountType,
    effectiveDiscountValue(row.discountStatus, row.discountValue),
  );

  const doctor =
    row.doctorName || row.doctorUsername
      ? displayStaffName(row.doctorPrefix, row.doctorName, row.doctorUsername ?? "")
      : null;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <Link
          href={`/clinic/appointments/${id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointment
        </Link>
      </div>

      <InvoicePrintFrame defaultFormat={clinic?.invoicePaper ?? "a4"}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">{clinic?.name ?? "Clinic"}</div>
            <div className="text-[0.9em] opacity-70">Invoice</div>
          </div>
          <div className="text-right text-[0.9em]">
            {invoice ? <div className="font-semibold">{invoice.label}</div> : null}
            {row.queueNumber != null ? (
              <div className="opacity-70">Appointment #{row.queueNumber}</div>
            ) : null}
            <div>{fmtDate(row.scheduledAt)}</div>
          </div>
        </div>

        {/* Parties */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          <div>
            <span className="opacity-70">Patient: </span>
            <span className="font-medium">{row.patientName}</span>
            {row.patientPhone ? <span className="opacity-70"> · {row.patientPhone}</span> : null}
          </div>
          {mrnLabel ? (
            <div>
              <span className="opacity-70">MRN#: </span>
              <span className="tabular-nums">{mrnLabel}</span>
            </div>
          ) : null}
          {doctor ? (
            <div>
              <span className="opacity-70">Doctor: </span>
              {doctor}
            </div>
          ) : null}
        </div>

        {/* Line items */}
        <table className="mt-3 w-full border-collapse text-[0.95em]">
          <thead>
            <tr className="border-b border-black/20 text-left">
              <th className="py-1 font-normal opacity-70">Item</th>
              <th className="py-1 text-right font-normal opacity-70">Qty</th>
              <th className="py-1 text-right font-normal opacity-70">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.consultation > 0 ? (
              <tr>
                <td className="py-1">Consultation</td>
                <td className="py-1 text-right">1</td>
                <td className="py-1 text-right tabular-nums">{formatPkr(bill.consultation)}</td>
              </tr>
            ) : null}
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1">{it.name}</td>
                <td className="py-1 text-right">{it.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatPkr(it.unitPrice * it.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          {bill.appointmentDiscount > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="opacity-70">Subtotal</span>
                <span className="tabular-nums">{formatPkr(bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Discount</span>
                <span className="tabular-nums">−{formatPkr(bill.appointmentDiscount)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between border-t border-black/20 pt-1 text-[1.05em] font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatPkr(bill.net)}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">Paid</span>
            <span className="tabular-nums">{formatPkr(aBill.collected)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Outstanding</span>
            <span className="tabular-nums">{formatPkr(aBill.outstanding)}</span>
          </div>
        </div>

        <div className="mt-3 border-t border-black/20 pt-2 text-center text-[0.85em] opacity-70">
          {clinic?.signature ? <div>{clinic.signature}</div> : null}
          <div>Thank you.</div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
