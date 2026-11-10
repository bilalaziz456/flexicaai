import { notFound } from "next/navigation";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import {
  getClinicInvoiceForPrint,
  getCompanyInvoiceSettings,
} from "@/core/admin/clinic-invoices";
import { getCompanySupportContact } from "@/core/admin/company-settings";
import {
  formatIsoDay,
  formatPeriod,
  formatRate,
  invoiceStatus,
  invoiceStatusLabel,
  localIsoDate,
  type InvoiceStatus,
} from "@/core/admin/invoice-status";
import { BRAND_EMAIL, BRAND_PHONE, BRAND_WEBSITE } from "@/core/lib/brand";
import { getCompanyLogoDataUri } from "@/core/lib/company-logo";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { BackLink } from "@/core/ui/back-link";
import { InvoicePrintFrame } from "@/core/ui/invoice-print";

const fmtMoney = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (d: Date) => formatIsoDay(localIsoDate(d));

/** The status pill: green when paid, amber part-paid, red owed, solid red overdue. */
function pillClass(s: InvoiceStatus): string {
  if (s.state === "paid") return "bg-emerald-100 text-emerald-800";
  if (s.overdue) return "bg-red-600 text-white";
  if (s.state === "partly_paid") return "bg-amber-100 text-amber-800";
  return "bg-red-50 text-red-600";
}

/**
 * The green PAID stamp on a settled invoice — tilted and outlined like an ink stamp,
 * with the date it was settled (the last payment against it). Drawn in the page flow,
 * not floated over it, so it can never cover a figure on paper or in the PDF.
 */
function PaidStamp({ on }: { on: Date | null }) {
  return (
    <div className="ml-4 inline-flex -rotate-12 flex-col items-center rounded-lg border-[3px] border-emerald-600 px-7 py-1.5 text-emerald-600">
      <span className="text-[2.4em] font-extrabold leading-none tracking-[0.2em]">
        PAID
      </span>
      {on ? (
        <span className="mt-1 text-[0.8em] font-bold uppercase tracking-wide">
          {fmtDate(on)}
        </span>
      ) : null}
    </div>
  );
}

/** A small filled tab heading a section, as the table's header bar is filled. */
function SectionTab({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block bg-brand-teal px-3 py-1 text-[0.8em] font-bold uppercase tracking-wide text-brand-navy">
      {children}
    </div>
  );
}

/**
 * Printable subscription invoice — FlexicaAI (issuer) → clinic (bill-to), A4.
 *
 * Laid out after the owner's reference design (2026-11-11), in the app's own colours:
 * brand teal fills with navy type (the pairing every primary button in the app uses,
 * and the one that stays legible — white on this teal is too faint to read in print),
 * a navy bar for the figure that matters, and a teal/navy band at the foot.
 *
 * The sheet is at least one page tall so that band sits at the bottom of the page, not
 * under the last line; a long payment history simply pushes it onto page two.
 *
 * NTN / STRN print only on an invoice that carries tax — a sales-tax invoice must name
 * the supplier's registration, a plain one does not.
 *
 * Gated by `sub_invoices:view`; a team member who is not a full admin sees only the
 * clinics they manage (a 404 otherwise, like the clinic page).
 */
export default async function ClinicInvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const user = await requireAdminCapability("sub_invoices:view");
  const { id } = await params;
  const { print } = await searchParams;
  const [inv, contact, logo, company] = await Promise.all([
    getClinicInvoiceForPrint(id),
    getCompanySupportContact(),
    getCompanyLogoDataUri(),
    getCompanyInvoiceSettings(),
  ]);
  if (!inv) notFound();
  if (!canManageTeam(user) && inv.clinic.assignedTo !== user.id) notFound();

  const c = inv.clinic;
  const location = [c.address, c.city, c.country].filter(Boolean).join(", ");
  const period = formatPeriod(inv.periodStart, inv.periodEnd);
  // Owed = the amount plus any tax on it; status and balance are worked out on that.
  const status = invoiceStatus(
    inv.total,
    inv.paid,
    inv.dueOn,
    localIsoDate(new Date()),
  );
  const hasTax = inv.taxAmount > 0 && inv.taxRate !== null;
  const phone = contact.phone || BRAND_PHONE;
  const email = contact.email || BRAND_EMAIL;
  const taxName = `${inv.taxLabel ?? "Tax"} (${formatRate(inv.taxRate ?? 0)}%)`;
  // Settled on = the latest payment or credit against it (a refund settles nothing).
  const settledOn = inv.payments
    .filter((p) => p.kind !== "refund")
    .reduce<Date | null>(
      (latest, p) => (!latest || p.occurredAt > latest ? p.occurredAt : latest),
      null,
    );

  // The totals stack: alternating teal / grey bars, the balance due in navy last.
  const totals: { label: string; value: string }[] = [
    ...(hasTax
      ? [
          { label: "Subtotal", value: fmtMoney(inv.amount) },
          { label: taxName, value: fmtMoney(inv.taxAmount) },
        ]
      : []),
    { label: "Total", value: fmtMoney(inv.total) },
    {
      label: "Amount paid",
      value: inv.paid > 0 ? `− ${fmtMoney(inv.paid)}` : fmtMoney(0),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <BackLink href="/admin/finance/invoices">Back to invoices</BackLink>
      </div>

      <InvoicePrintFrame
        defaultFormat="a4"
        allowed={["a4"]}
        credit={false}
        serverPrintPaper={print ?? null}
        fileName={`Subscription invoice ${inv.label}`}
      >
        {/* The column is one page tall, so the foot band lands at the bottom of page one.
            Its height is worked out from the sheet's WIDTH, not fixed in mm: the PDF scales
            the sheet to fit A4's width, and on a screen narrower than 210mm a fixed 265mm
            came out 3% too tall once scaled — the band stayed on page one and a blank
            page two was added (owner's report, 2026-11-11). With W the content width,
            the page is (W + 28mm) × 297/210 tall; less the 28mm of margin and ~3mm
            spare, that is 141.43% of W + 8mm. On paper W is 182mm, giving 265mm. */}
        <div style={{ containerType: "inline-size" }}>
          <div
            className="flex flex-col text-brand-navy"
            style={{ minHeight: "calc(141.43cqw + 8mm)" }}
          >
            {/* ---- Issuer + bill-to (left) · invoice identity (right) ---- */}
            <div className="flex items-start justify-between gap-8">
              <div className="space-y-5">
                <div className="space-y-2">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logo}
                      alt="FlexicaAI"
                      className="h-12 w-auto object-contain"
                    />
                  ) : (
                    <div className="text-2xl font-bold text-brand-teal">
                      FlexicaAI
                    </div>
                  )}
                  <div className="space-y-0.5 text-[0.82em] leading-snug text-black/65">
                    <div className="flex items-center gap-1.5">
                      <Globe
                        className="size-3 text-brand-teal"
                        aria-hidden="true"
                      />{" "}
                      {BRAND_WEBSITE}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Phone
                        className="size-3 text-brand-teal"
                        aria-hidden="true"
                      />{" "}
                      {phone}
                    </div>
                    {email ? (
                      <div className="flex items-center gap-1.5">
                        <Mail
                          className="size-3 text-brand-teal"
                          aria-hidden="true"
                        />{" "}
                        {email}
                      </div>
                    ) : null}
                    {hasTax && company.ntn ? (
                      <div>NTN: {company.ntn}</div>
                    ) : null}
                    {hasTax && company.strn ? (
                      <div>STRN: {company.strn}</div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-0.5 text-[0.92em]">
                  <div className="text-[1.05em] font-bold">Invoice to</div>
                  <div className="text-[1.08em] font-semibold">{c.name}</div>
                  {c.ownerName ? (
                    <div className="text-black/75">{c.ownerName}</div>
                  ) : null}
                  {c.ownerPhone ? (
                    <div className="flex items-center gap-1.5 text-black/75">
                      <Phone
                        className="size-3 text-brand-teal"
                        aria-hidden="true"
                      />{" "}
                      {c.ownerPhone}
                    </div>
                  ) : null}
                  {c.ownerEmail ? (
                    <div className="flex items-center gap-1.5 text-black/75">
                      <Mail
                        className="size-3 text-brand-teal"
                        aria-hidden="true"
                      />{" "}
                      {c.ownerEmail}
                    </div>
                  ) : null}
                  {location ? (
                    <div className="flex items-start gap-1.5 text-black/75">
                      <MapPin
                        className="mt-0.5 size-3 shrink-0 text-brand-teal"
                        aria-hidden="true"
                      />{" "}
                      {location}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="text-right">
                {/* Always "Invoice", taxed or not (owner's call, 2026-11-11). */}
                <div className="text-[2.6em] font-extrabold uppercase leading-none tracking-[0.06em]">
                  Invoice
                </div>
                <div className="mt-1.5 text-[1.05em] font-semibold text-black/70">
                  {inv.label}
                </div>
                <table className="ml-auto mt-4 text-[0.92em]">
                  <tbody>
                    <tr>
                      <td className="py-0.5 pr-4 text-left font-semibold">
                        Issue date:
                      </td>
                      <td className="py-0.5 text-right">
                        {fmtDate(inv.issuedAt)}
                      </td>
                    </tr>
                    {inv.dueOn ? (
                      <tr>
                        <td className="py-0.5 pr-4 text-left font-semibold">
                          Due date:
                        </td>
                        <td className="py-0.5 text-right">
                          {formatIsoDay(inv.dueOn)}
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="py-1 pr-4 text-left font-semibold">
                        Invoice status:
                      </td>
                      <td className="py-1 text-right">
                        <span
                          className={`inline-block rounded-full px-3 py-0.5 text-[0.85em] font-bold uppercase tracking-wide ${pillClass(status)}`}
                        >
                          {invoiceStatusLabel(status)}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---- What is charged ---- */}
            <table className="mt-8 w-full border-collapse text-[0.95em]">
              <thead>
                <tr className="bg-brand-teal text-left text-brand-navy">
                  <th className="px-3 py-2 font-bold">Description</th>
                  <th className="px-3 py-2 font-bold">Period</th>
                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                  {hasTax ? (
                    <th className="px-3 py-2 text-right font-bold">Tax</th>
                  ) : null}
                  <th className="px-3 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-black/15 align-top">
                  <td className="px-3 py-3">
                    <div className="font-semibold">FlexicaAI subscription</div>
                    {inv.note ? (
                      <div className="text-[0.85em] text-black/60">
                        {inv.note}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {period ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {fmtMoney(inv.amount)}
                  </td>
                  {hasTax ? (
                    <td className="px-3 py-3 text-right tabular-nums">
                      {fmtMoney(inv.taxAmount)}
                    </td>
                  ) : null}
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">
                    {fmtMoney(inv.total)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ---- Payments + how to pay (left) · totals (right) ---- */}
            <div className="mt-8 grid grid-cols-[1fr_minmax(0,46%)] items-start gap-8">
              <div className="space-y-6">
                {inv.payments.length > 0 ? (
                  <div className="space-y-2">
                    <SectionTab>Payments received</SectionTab>
                    <table className="w-full border-collapse text-[0.88em]">
                      <thead>
                        <tr className="border-b border-black/30 text-left">
                          <th className="py-1 font-semibold">Date</th>
                          <th className="py-1 font-semibold">Method</th>
                          <th className="py-1 font-semibold">Reference</th>
                          <th className="py-1 text-right font-semibold">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.payments.map((p, i) => (
                          <tr key={i} className="border-b border-black/10">
                            <td className="py-1">{fmtDate(p.occurredAt)}</td>
                            <td className="py-1">
                              {p.kind === "refund"
                                ? "Refund"
                                : p.kind === "credit"
                                  ? "Credit"
                                  : p.method
                                    ? vocabularyLabel(
                                        "payment_methods",
                                        p.method,
                                      )
                                    : "—"}
                            </td>
                            <td className="py-1">{p.reference ?? "—"}</td>
                            <td className="py-1 text-right tabular-nums">
                              {p.kind === "refund"
                                ? `− ${fmtMoney(p.amount)}`
                                : fmtMoney(p.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <SectionTab>
                    {status.balance > 0 ? "How to pay" : "Payment"}
                  </SectionTab>
                  <div className="space-y-1 text-[0.88em] leading-relaxed text-black/75">
                    {status.balance > 0 ? (
                      <p>
                        Please pay{" "}
                        <span className="font-semibold text-brand-navy">
                          {fmtMoney(status.balance)}
                        </span>
                        {inv.dueOn ? ` by ${formatIsoDay(inv.dueOn)}` : ""} and
                        quote invoice{" "}
                        <span className="font-semibold text-brand-navy">
                          {inv.label}
                        </span>{" "}
                        with your payment.
                      </p>
                    ) : (
                      <p>This invoice is paid in full. Thank you.</p>
                    )}
                    <p>
                      Questions about this invoice: {phone}
                      {email ? ` · ${email}` : ""}
                    </p>
                  </div>
                </div>

                {status.state === "paid" ? <PaidStamp on={settledOn} /> : null}
              </div>

              <div>
                <div className="text-[0.95em] font-semibold">
                  {totals.map((t, i) => (
                    <div
                      key={t.label}
                      className={`flex items-center justify-between px-4 py-2 ${
                        i % 2 === 0
                          ? "bg-brand-teal text-brand-navy"
                          : "bg-slate-200 text-brand-navy"
                      }`}
                    >
                      <span>{t.label}</span>
                      <span className="tabular-nums">{t.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-brand-navy px-4 py-2.5 text-[1.15em] font-bold text-white">
                    <span>Balance due</span>
                    <span className="tabular-nums">
                      {fmtMoney(status.balance)}
                    </span>
                  </div>
                </div>
                {status.overpaid > 0 ? (
                  <div className="mt-1 flex justify-between px-4 text-[0.85em] text-black/70">
                    <span>Paid in excess</span>
                    <span className="tabular-nums">
                      {fmtMoney(status.overpaid)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* ---- Foot band: pinned to the bottom of the page by the column's min-height ---- */}
            <div className="mt-auto flex h-9 text-[0.9em] font-semibold">
              <div
                className="flex w-[40%] items-center bg-brand-teal pl-4 text-brand-navy"
                style={{
                  clipPath:
                    "polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%)",
                }}
              >
                {BRAND_WEBSITE}
              </div>
              <div
                className="-ml-3 flex flex-1 items-center justify-end bg-brand-navy pr-4 text-white"
                style={{
                  clipPath: "polygon(18px 0, 100% 0, 100% 100%, 0 100%)",
                }}
              >
                Thank you for your business!
              </div>
            </div>
          </div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
