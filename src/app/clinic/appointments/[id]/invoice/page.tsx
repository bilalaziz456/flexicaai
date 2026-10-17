import { Fragment } from "react";
import { formatDateTime12h } from "@/core/lib/date-time";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { listAppointmentPayments } from "@/core/billing/payments";
import { PaymentHistoryPrint } from "@/core/ui/payment-history-print";
import { FlashToast } from "@/core/ui/toast";
import { getAppointmentForDocument } from "@/core/billing/invoice";
import { getClinic } from "@/core/clinics/get-clinic";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
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
import { getClinicLogoDataUri } from "@/core/clinics/logo";
import { BackLink } from "@/core/ui/back-link";
import { InvoicePrintFrame } from "@/core/ui/invoice-print";

/**
 * Printable invoice for an appointment (Finance). Thermal / A5 / A4 via the print
 * frame. Shows the clinic header, patient, line items (consultation + procedures),
 * discount, total, and paid/outstanding. Gated by the sales feature + billing:view.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `from=invoice`: opened from the Invoices pages, so Back returns to the invoice
   *  rather than to the appointment. `created=1`: just saved with "Save & print". */
  searchParams: Promise<{ from?: string; created?: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const { id } = await params;
  const { from, created } = await searchParams;
  const fromInvoice = from === "invoice";

  const row = await getAppointmentForDocument(clinicId, id);
  if (!row) notFound();

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales") || !can(user, "billing", "view")) {
    notFound();
  }
  const mrnLabel = row.patientMrnLabel;
  const logo = await getClinicLogoDataUri(clinic?.logoKey);

  const [items, aBill, invoice, ledger] = await Promise.all([
    getAppointmentProcedureItems(clinicId, id),
    getAppointmentBill(clinicId, id),
    getInvoiceForAppointment(clinicId, id),
    listAppointmentPayments(clinicId, id),
  ]);
  // Every payment and refund on this visit, for the printed history.
  const history = ledger
    .filter((e) => e.kind !== "advance")
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      amount: e.amount,
      occurredAt: e.occurredAt,
      methodLabel: e.method ? vocabularyLabel("payment_methods", e.method) : null,
      note: e.note,
    }));

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
  const fmtDateTime = (d: Date) => formatDateTime12h(d);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlashToast
        message={created && invoice ? `Invoice ${invoice.label} created.` : null}
        params={["created"]}
      />
      <div className="no-print">
        <BackLink href={fromInvoice ? `/clinic/invoices/${id}` : `/clinic/appointments/${id}`}>
          {fromInvoice ? "Back to invoice" : "Back to appointment"}
        </BackLink>
      </div>

      <InvoicePrintFrame
        fileName={invoice ? `Invoice ${invoice.label}` : "Bill"}
        defaultFormat={clinic?.invoicePaper ?? "a4"}
        allowed={clinic?.invoicePapersEnabled}
        logo={logo}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">{clinic?.name ?? "Clinic"}</div>
            <div className="text-[0.9em] opacity-70">Invoice</div>
          </div>
          <div className="text-right text-[0.9em]">
            {invoice ? <div className="font-semibold">{invoice.label}</div> : null}
            {/* When the invoice was raised, and when the visit is/was — two different
                moments (a visit billed in advance, or invoiced after the fact). */}
            {invoice ? (
              <div>
                <span className="opacity-70">Invoice date: </span>
                {fmtDateTime(invoice.issuedAt)}
              </div>
            ) : null}
            <div>
              <span className="opacity-70">Appointment: </span>
              {fmtDateTime(row.scheduledAt)}
            </div>
            {/* Changed after it was issued — the visit edited, or a payment on it
                cancelled (appointments.edited_at). A copy handed over earlier is then
                visibly not the latest. */}
            {row.editedAt && (!invoice || row.editedAt > invoice.issuedAt) ? (
              <div>
                <span className="opacity-70">Edited: </span>
                {fmtDateTime(row.editedAt)}
              </div>
            ) : null}
            {/* The appointment's own number (its queue token), on its own labelled
                line, and only when it has one — a visit without a doctor gets none. */}
            {row.queueNumber != null ? (
              <div>
                <span className="opacity-70">Appointment #: </span>
                {row.queueNumber}
              </div>
            ) : null}
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
            {items.map((it, idx) => {
              // A line's discount is the clinic offer it was booked with. Printed
              // under its procedure so the patient sees the full price and what came
              // off it — and so the printed lines still add up to the total.
              const off = bill.lines[idx]?.discount ?? 0;
              // Services and one-off charges come last (the read orders them so) under
              // their own heading, so the patient can see what the extra is for.
              const firstOther = it.isService && !items[idx - 1]?.isService;
              return (
                <Fragment key={idx}>
                  {firstOther ? (
                    <tr>
                      <td className="pt-2 pb-0.5 text-[0.9em] font-semibold" colSpan={3}>
                        Other charges
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <td className="py-1">{it.name}</td>
                    <td className="py-1 text-right">{it.quantity}</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatPkr(it.unitPrice * it.quantity)}
                    </td>
                  </tr>
                  {off > 0 ? (
                    <tr>
                      <td className="pb-1 pl-3 text-[0.9em] opacity-80" colSpan={2}>
                        {/* The patient's wording (owner's call): "10% discount", not
                            "Clinic offer" — what it is called internally is ours. */}
                        {it.discountType === "percent" ? `${it.discountValue}% discount` : "Discount"}
                      </td>
                      <td className="pb-1 text-right text-[0.9em] tabular-nums">−{formatPkr(off)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
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
        </div>

        {/* Every payment and refund, with what was due after each. */}
        <PaymentHistoryPrint bill={aBill.billTotal} entries={history} />

        <div className="mt-2 space-y-0.5 border-t border-black/20 pt-1 text-[0.95em]">
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
          {clinic?.whatsappSignature ? <div>{clinic.whatsappSignature}</div> : null}
          <div>Thank you.</div>
          {/* Who printed this copy, and when — the page is rendered when it is opened
              for printing, so this is the print time. */}
          <div className="mt-1 text-[0.9em]">
            Printed by {displayStaffName(user.prefix, user.fullName, user.username)} · {fmtDateTime(new Date())}
          </div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
