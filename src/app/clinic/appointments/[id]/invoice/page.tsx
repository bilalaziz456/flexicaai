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
  // Where the bill stands, stamped on the invoice. A void invoice says so above all.
  const stamp: { label: string; dashed?: boolean } | null = invoice?.voided
    ? { label: "Void", dashed: true }
    : aBill.paymentStatus === "paid" && aBill.billTotal > 0
      ? { label: "Paid" }
      : aBill.paymentStatus === "partial"
        ? { label: "Partly paid", dashed: true }
        : aBill.paymentStatus === "unpaid"
          ? { label: "Unpaid", dashed: true }
          : null;

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
        {/* ── Header: the clinic, and the document's number as the boldest mark on it. ── */}
        <header className="flex items-start justify-between gap-4 group-data-[paper=thermal]/sheet:flex-col group-data-[paper=thermal]/sheet:items-center group-data-[paper=thermal]/sheet:gap-2 group-data-[paper=thermal]/sheet:text-center">
          <div className="min-w-0">
            <div className="text-[1.45em] leading-tight font-bold tracking-tight">{clinic?.name ?? "Clinic"}</div>
            {clinic?.publicAddress || clinic?.whatsappDisplayNumber ? (
              <div className="mt-0.5 text-[0.82em] opacity-60">
                {[clinic?.publicAddress, clinic?.whatsappDisplayNumber].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-right group-data-[paper=thermal]/sheet:text-center">
            <div className="text-[0.7em] font-semibold tracking-[0.32em] uppercase opacity-60">Invoice</div>
            {invoice ? (
              <div className="mt-1 inline-block rounded-md border-2 border-black px-2.5 py-0.5 text-[1.05em] font-bold tracking-wide tabular-nums">
                {invoice.label}
              </div>
            ) : null}
          </div>
        </header>

        {/* ── When: the invoice and the visit are two moments (billed in advance, or
            invoiced after the fact); "Edited" only when it changed after issue. ── */}
        <dl className="mt-3 grid grid-cols-4 gap-x-3 gap-y-2 border-y border-black/15 py-2 group-data-[paper=a5]/sheet:grid-cols-2 group-data-[paper=thermal]/sheet:grid-cols-2">
          {invoice ? <Meta label="Invoice date" value={fmtDateTime(invoice.issuedAt)} /> : null}
          <Meta label="Appointment" value={fmtDateTime(row.scheduledAt)} />
          {row.editedAt && (!invoice || row.editedAt > invoice.issuedAt) ? (
            <Meta label="Edited" value={fmtDateTime(row.editedAt)} />
          ) : null}
          {/* The appointment's own number (its queue token) — only when it has one. */}
          {row.queueNumber != null ? <Meta label="Appointment #" value={String(row.queueNumber)} /> : null}
        </dl>

        {/* ── Who ── */}
        <div className="mt-3 grid grid-cols-2 gap-4 group-data-[paper=thermal]/sheet:grid-cols-1 group-data-[paper=thermal]/sheet:gap-2">
          <div className="min-w-0">
            <Caption>Billed to</Caption>
            <div className="text-[1.1em] font-semibold">{row.patientName}</div>
            <div className="text-[0.88em] opacity-65">
              {[row.patientPhone, mrnLabel ? `MRN ${mrnLabel}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          {doctor ? (
            <div className="min-w-0 text-right group-data-[paper=thermal]/sheet:text-left">
              <Caption>Doctor</Caption>
              <div className="font-medium">{doctor}</div>
            </div>
          ) : null}
        </div>

        {/* ── Items ── */}
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left text-[0.7em] tracking-[0.12em] uppercase">
              <th className="py-1 font-semibold">Item</th>
              <th className="w-10 py-1 text-right font-semibold">Qty</th>
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.consultation > 0 ? (
              <tr className="border-b border-black/10">
                <td className="py-1.5">Consultation</td>
                <td className="py-1.5 text-right tabular-nums">1</td>
                <td className="py-1.5 text-right whitespace-nowrap tabular-nums">{formatPkr(bill.consultation)}</td>
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
                      <td className="pt-3 pb-0.5 text-[0.7em] font-semibold tracking-[0.12em] uppercase opacity-60" colSpan={3}>
                        Other charges
                      </td>
                    </tr>
                  ) : null}
                  <tr className={off > 0 ? "" : "border-b border-black/10"}>
                    <td className="py-1.5 pr-2">{it.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                    <td className="py-1.5 text-right whitespace-nowrap tabular-nums">{formatPkr(it.unitPrice * it.quantity)}</td>
                  </tr>
                  {off > 0 ? (
                    <tr className="border-b border-black/10">
                      <td className="pb-1.5 pl-3 text-[0.85em] opacity-65" colSpan={2}>
                        {/* The patient's wording (owner's call): "10% discount", not
                            "Clinic offer" — what it is called internally is ours. */}
                        ↳ {it.discountType === "percent" ? `${it.discountValue}% discount` : "Discount"}
                      </td>
                      <td className="pb-1.5 text-right text-[0.85em] whitespace-nowrap tabular-nums opacity-65">
                        −{formatPkr(off)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* ── Total, then what has been paid against it ── */}
        <div className="mt-3 ml-auto w-full max-w-[62%] group-data-[paper=thermal]/sheet:max-w-none">
          {bill.appointmentDiscount > 0 ? (
            <div className="space-y-0.5 pb-1.5">
              <SumRow label="Subtotal" value={formatPkr(bill.subtotal)} />
              <SumRow label="Discount" value={`−${formatPkr(bill.appointmentDiscount)}`} />
            </div>
          ) : null}
          {/* Label and amount at one size and weight — a small spaced-out label beside a
              large figure read as two different things (owner's report, 2026-10-18). */}
          <div className="flex items-center justify-between gap-3 rounded-md bg-black px-3 py-2 text-[1.2em] font-bold text-white">
            <span>Total</span>
            <span className="whitespace-nowrap tabular-nums">{formatPkr(bill.net)}</span>
          </div>
          <div className="mt-2 space-y-0.5">
            <SumRow label="Paid" value={formatPkr(aBill.collected)} />
            <SumRow label="Outstanding" value={formatPkr(aBill.outstanding)} strong />
          </div>
        </div>

        {/* A stamp says where the bill stands at a glance — the first thing the
            patient (or their insurer) looks for. */}
        {stamp ? (
          <div className="mt-3 flex justify-start group-data-[paper=thermal]/sheet:justify-center">
            <span
              className={`inline-block -rotate-3 rounded-md border-2 border-black px-3 py-0.5 text-[0.85em] font-bold tracking-[0.3em] uppercase group-data-[paper=thermal]/sheet:rotate-0 ${stamp.dashed ? "border-dashed" : ""}`}
            >
              {stamp.label}
            </span>
          </div>
        ) : null}

        {/* Every payment and refund, with what was due after each. */}
        <PaymentHistoryPrint bill={aBill.billTotal} entries={history} />

        <footer className="mt-5 border-t border-black/15 pt-2.5 text-center text-[0.85em]">
          <div className="font-medium">Thank you for choosing {clinic?.name ?? "us"}.</div>
          {clinic?.whatsappSignature ? <div className="opacity-65">{clinic.whatsappSignature}</div> : null}
          {/* Who printed this copy, and when — the page is rendered when it is opened
              for printing, so this is the print time. */}
          <div className="mt-1 text-[0.88em] opacity-55">
            Printed by {displayStaffName(user.prefix, user.fullName, user.username)} · {fmtDateTime(new Date())}
          </div>
        </footer>
      </InvoicePrintFrame>
    </div>
  );
}

/** A small uppercase caption over a value — the invoice's one label style. */
function Caption({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 text-[0.68em] font-semibold tracking-[0.14em] uppercase opacity-55">{children}</div>;
}

/** One "when" fact in the strip under the header. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68em] font-semibold tracking-[0.12em] uppercase opacity-55">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** A label and an amount on one line of the totals. */
function SumRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "opacity-65"}>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
