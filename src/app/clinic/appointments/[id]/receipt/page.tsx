import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getAppointmentBill } from "@/core/billing/bill";
import { listAppointmentPayments } from "@/core/billing/payments";
import { formatPkr } from "@/core/appointments/fee";
import { formatMrn } from "@/core/patients/mrn";
import { InvoicePrintFrame } from "@/app/reception/invoice-print";

/**
 * Payment receipt for a visit (Finance) — acknowledges money received against this
 * appointment: the individual payments/advances applied, the total paid, and the
 * running balance. Thermal / A5 / A4 via the shared print frame. Gated by the sales
 * feature + billing:view; clinic-scoped. (The invoice is the bill; this is the receipt.)
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const { id } = await params;

  const [row] = await db
    .select({
      scheduledAt: appointments.scheduledAt,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      patientMrn: patients.mrn,
      patientCreatedAt: patients.createdAt,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
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

  const [aBill, ledger] = await Promise.all([
    getAppointmentBill(clinicId, id),
    listAppointmentPayments(clinicId, id),
  ]);
  // Only entries that represent money received on THIS visit (exclude refunds/voids
  // context — a refund shows as a negative line so the receipt reconciles).
  const received = ledger.filter((e) => e.kind !== "advance");

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const KIND_LABEL: Record<string, string> = {
    payment: "Payment",
    advance_applied: "Advance applied",
    refund: "Refund",
  };

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
            <div className="text-[0.9em] opacity-70">Payment receipt</div>
          </div>
          <div className="text-right text-[0.9em]">
            <div>{fmtDate(row.scheduledAt)}</div>
          </div>
        </div>

        {/* Patient */}
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
        </div>

        {/* Payments received */}
        {received.length > 0 ? (
          <table className="mt-3 w-full border-collapse text-[0.95em]">
            <thead>
              <tr className="border-b border-black/20 text-left">
                <th className="py-1 font-normal opacity-70">Date</th>
                <th className="py-1 font-normal opacity-70">Type</th>
                <th className="py-1 text-right font-normal opacity-70">Amount</th>
              </tr>
            </thead>
            <tbody>
              {received.map((e) => (
                <tr key={e.id} className="border-b border-black/10">
                  <td className="py-1">{fmtDate(e.occurredAt)}</td>
                  <td className="py-1">
                    {KIND_LABEL[e.kind] ?? e.kind}
                    {e.method ? <span className="opacity-70"> · {e.method}</span> : null}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {e.kind === "refund" ? "−" : ""}
                    {formatPkr(e.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-[0.9em] opacity-70">No payments recorded on this visit.</p>
        )}

        {/* Totals */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          <div className="flex justify-between border-t border-black/20 pt-1 text-[1.05em] font-bold">
            <span>Total paid</span>
            <span className="tabular-nums">{formatPkr(aBill.collected)}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-70">Bill</span>
            <span className="tabular-nums">{formatPkr(aBill.billTotal)}</span>
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
