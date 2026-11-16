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
  describePeriodLength,
  periodEndFor,
  periodLength,
  formatRate,
  invoiceStatus,
  invoiceStatusLabel,
  localIsoDate,
  type InvoiceStatus,
  type PeriodLength,
} from "@/core/admin/invoice-status";
import { BRAND_EMAIL, BRAND_PHONE, BRAND_WEBSITE } from "@/core/lib/brand";
import { getCompanyLogoDataUri } from "@/core/lib/company-logo";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { BackLink } from "@/core/ui/back-link";
import { InvoicePrintFrame } from "@/core/ui/invoice-print";

const fmtMoney = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (d: Date) => formatIsoDay(localIsoDate(d));
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The status chip: green paid, amber part-paid, red owed, solid red overdue. */
function chipClass(s: InvoiceStatus): string {
  if (s.state === "paid") return "bg-emerald-50 text-emerald-700 ring-emerald-600/30";
  if (s.overdue) return "bg-red-600 text-white ring-red-700";
  if (s.state === "partly_paid") return "bg-amber-50 text-amber-800 ring-amber-500/40";
  return "bg-red-50 text-red-700 ring-red-500/30";
}

/**
 * The months the invoice pays for, one cell each ("Jan 26", "Feb 26"…), plus a narrower
 * cell for a part month. Labelled by the month each billing month STARTS in, so
 * 15 Jan – 14 Feb is one cell, "Jan 26". Null past 24 months — a strip that long stops
 * being readable and the Months figure beside it already says it.
 */
function coverageCells(start: string, len: PeriodLength): { label: string; part: boolean }[] | null {
  const count = len.months + (len.days ? 1 : 0);
  if (count === 0 || count > 24) return null;
  const cells: { label: string; part: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    // The day after the previous month's end is where month i starts.
    const from = i === 0 ? start : nextDay(periodEndFor(start, i));
    const [y, m] = from.split("-").map(Number);
    cells.push({ label: `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`, part: i === len.months });
  }
  return cells;
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** A small uppercase label over a value — the sheet's one heading style. */
function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[0.68em] font-bold uppercase tracking-[0.16em] text-[#0a7d84] ${className}`}>
      {children}
    </div>
  );
}

/**
 * The PAID seal on a settled invoice: a round ink stamp with the date it was settled
 * (the last payment against it). In the page flow, never floated over a figure.
 */
function PaidSeal({ on }: { on: Date | null }) {
  return (
    <div className="grid size-[7.2em] shrink-0 -rotate-12 place-items-center rounded-full border-[3px] border-emerald-600 p-1 text-emerald-600">
      <div className="grid size-full place-items-center rounded-full border border-dashed border-emerald-600/70 text-center">
        <div>
          <div className="text-[0.55em] font-bold uppercase tracking-[0.2em]">FlexicaAI</div>
          <div className="text-[1.55em] font-extrabold leading-none tracking-[0.12em]">PAID</div>
          {on ? <div className="mt-0.5 text-[0.55em] font-bold uppercase tracking-wide">{fmtDate(on)}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Printable subscription invoice — FlexicaAI (issuer) → clinic (bill-to), A4.
 *
 * Redesigned 2026-11-16 at the owner's request ("more aesthetic, modern and unique"):
 * a navy masthead with the number and the amount due, a summary strip of the four facts
 * a clinic looks for (amount due, due date, period, status), and a COVERAGE strip — one
 * cell per month the invoice pays for — which is what makes a 6-month invoice read as
 * six months at a glance. Brand teal fills always carry navy type: white on this teal
 * is too faint to read in print.
 *
 * The sheet is at least one page tall so the foot sits at the bottom of the page, not
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
  // How many months this invoice bills (owner, 2026-11-16) — only when both dates are set.
  const periodLen = inv.periodStart && inv.periodEnd ? periodLength(inv.periodStart, inv.periodEnd) : null;
  const months = periodLen ? describePeriodLength(periodLen) : null;
  const cells = periodLen && inv.periodStart ? coverageCells(inv.periodStart, periodLen) : null;
  // Owed = the amount plus any tax on it; status and balance are worked out on that.
  const status = invoiceStatus(inv.total, inv.paid, inv.dueOn, localIsoDate(new Date()));
  const hasTax = inv.taxAmount > 0 && inv.taxRate !== null;
  const phone = contact.phone || BRAND_PHONE;
  const email = contact.email || BRAND_EMAIL;
  const taxName = `${inv.taxLabel ?? "Tax"} (${formatRate(inv.taxRate ?? 0)}%)`;
  // Settled on = the latest payment or credit against it (a refund settles nothing).
  const settledOn = inv.payments
    .filter((p) => p.kind !== "refund")
    .reduce<Date | null>((latest, p) => (!latest || p.occurredAt > latest ? p.occurredAt : latest), null);
  const paid = status.state === "paid";
  // An invoice that bills only one-time fees has no subscription line (0152).
  const showSubscription = inv.subscriptionAmount > 0 || inv.feeLines.length === 0;

  const summary: { label: string; value: React.ReactNode; strong?: boolean }[] = [
    { label: paid ? "Amount paid" : "Amount due", value: fmtMoney(paid ? inv.paid : status.balance), strong: true },
    { label: "Due date", value: inv.dueOn ? formatIsoDay(inv.dueOn) : "On receipt" },
    {
      label: "Billing period",
      value: inv.periodStart && inv.periodEnd ? (
        <>
          {formatIsoDay(inv.periodStart)} – {formatIsoDay(inv.periodEnd)}
        </>
      ) : (
        "—"
      ),
    },
    {
      label: "Status",
      value: (
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.82em] font-bold uppercase tracking-wide ring-1 ${chipClass(status)}`}>
          {invoiceStatusLabel(status)}
        </span>
      ),
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
        {/* The column is one page tall, so the foot lands at the bottom of page one.
            Its height is worked out from the sheet's WIDTH, not fixed in mm: the PDF scales
            the sheet to fit A4's width, and on a screen narrower than 210mm a fixed 265mm
            came out 3% too tall once scaled — the foot stayed on page one and a blank
            page two was added (owner's report, 2026-11-11). With W the content width,
            the page is (W + 28mm) × 297/210 tall; less the 28mm of margin and ~3mm
            spare, that is 141.43% of W + 8mm. On paper W is 182mm, giving 265mm. */}
        <div style={{ containerType: "inline-size" }}>
          <div className="flex flex-col text-brand-navy" style={{ minHeight: "calc(141.43cqw + 8mm)" }}>
            {/* ---- Masthead ---- */}
            <div className="relative overflow-hidden rounded-[1.1em] bg-brand-navy px-7 py-6 text-white">
              {/* Quiet brand geometry in the corner: two teal rings and a dot grid. */}
              <div aria-hidden className="absolute -right-[3.5em] -top-[3.5em] size-[13em] rounded-full border-[1.6em] border-brand-teal/25" />
              <div aria-hidden className="absolute -right-[1em] top-[5.5em] size-[5em] rounded-full border-[0.5em] border-brand-teal/40" />
              <div
                aria-hidden
                className="absolute inset-y-0 left-[46%] w-[30%] opacity-[0.12]"
                style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "10px 10px" }}
              />
              <div className="relative flex items-start justify-between gap-6">
                <div>
                  {logo ? (
                    <div className="inline-block rounded-lg bg-white px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo} alt="FlexicaAI" className="h-9 w-auto object-contain" />
                    </div>
                  ) : (
                    <div className="text-[1.6em] font-extrabold tracking-tight">
                      Flexica<span className="text-brand-teal">AI</span>
                    </div>
                  )}
                  <div className="mt-3 text-[0.78em] text-white/70">Clinic management software · Subscription</div>
                </div>
                <div className="text-right">
                  {/* Always "Invoice", taxed or not (owner's call, 2026-11-11). */}
                  <div className="text-[0.72em] font-bold uppercase tracking-[0.3em] text-brand-teal">Invoice</div>
                  <div className="mt-1 font-mono text-[1.7em] font-bold leading-none tracking-tight">{inv.label}</div>
                  <div className="mt-2 text-[0.8em] text-white/70">Issued {fmtDate(inv.issuedAt)}</div>
                </div>
              </div>
            </div>

            {/* ---- Summary strip: the four facts a clinic looks for ---- */}
            <div className="mt-6 grid grid-cols-[1.25fr_1fr_1.6fr_1fr] overflow-hidden rounded-[0.9em] border border-brand-navy/10 bg-[#f1fbfb]">
              {summary.map((s, i) => (
                <div key={s.label} className={`px-4 py-3 ${i > 0 ? "border-l border-brand-navy/10" : ""}`}>
                  <Eyebrow>{s.label}</Eyebrow>
                  <div className={`mt-1 ${s.strong ? "text-[1.35em] font-extrabold tabular-nums" : "text-[0.92em] font-semibold"}`}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* ---- From · Billed to ---- */}
            <div className="mt-7 grid grid-cols-2 gap-6 text-[0.88em]">
              <div className="rounded-[0.9em] border border-brand-navy/10 p-4">
                <Eyebrow>From</Eyebrow>
                <div className="mt-1.5 text-[1.12em] font-bold">FlexicaAI</div>
                <div className="mt-1.5 space-y-0.5 text-black/65">
                  <Line icon={Globe}>{BRAND_WEBSITE}</Line>
                  <Line icon={Phone}>{phone}</Line>
                  {email ? <Line icon={Mail}>{email}</Line> : null}
                  {hasTax && company.ntn ? <div>NTN: {company.ntn}</div> : null}
                  {hasTax && company.strn ? <div>STRN: {company.strn}</div> : null}
                </div>
              </div>
              <div className="rounded-[0.9em] border border-brand-teal/50 bg-[#f1fbfb] p-4">
                <Eyebrow>Billed to</Eyebrow>
                <div className="mt-1.5 text-[1.12em] font-bold">{c.name}</div>
                <div className="mt-1.5 space-y-0.5 text-black/65">
                  {c.ownerName ? <div className="font-medium text-brand-navy/80">{c.ownerName}</div> : null}
                  {c.ownerPhone ? <Line icon={Phone}>{c.ownerPhone}</Line> : null}
                  {c.ownerEmail ? <Line icon={Mail}>{c.ownerEmail}</Line> : null}
                  {location ? <Line icon={MapPin}>{location}</Line> : null}
                </div>
              </div>
            </div>

            {/* ---- What is charged ---- */}
            <div className="mt-7">
              <div className="grid grid-cols-[1fr_auto] items-end border-b-2 border-brand-navy pb-1.5 text-[0.72em] font-bold uppercase tracking-[0.14em] text-brand-navy/60">
                <span>Description</span>
                <span>Amount</span>
              </div>
              {/* The subscription line — left off an invoice that bills one-time fees only. */}
              {showSubscription ? (
                <div className="grid grid-cols-[1fr_auto] gap-6 border-b border-brand-navy/10 py-4">
                  <div>
                    <div className="text-[1.05em] font-bold">FlexicaAI subscription</div>
                    {inv.note ? <div className="mt-0.5 text-[0.85em] text-black/60">{inv.note}</div> : null}
                    {months ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82em] text-black/65">
                        <span className="rounded-full bg-brand-teal px-2.5 py-0.5 font-bold text-brand-navy">{months}</span>
                        <span>
                          {formatIsoDay(inv.periodStart!)} – {formatIsoDay(inv.periodEnd!)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right text-[1.05em] font-bold tabular-nums">{fmtMoney(inv.subscriptionAmount)}</div>
                </div>
              ) : null}
              {/* One-time fees (training, implementation… 0152), one line each. */}
              {inv.feeLines.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-6 border-b border-brand-navy/10 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[1.05em] font-bold">{f.label}</span>
                      <span className="rounded-full border border-brand-teal px-2 py-0.5 text-[0.68em] font-bold uppercase tracking-wide text-[#0a7d84]">
                        One-time
                      </span>
                    </div>
                    {!showSubscription && i === 0 && inv.note ? (
                      <div className="mt-0.5 text-[0.85em] text-black/60">{inv.note}</div>
                    ) : null}
                  </div>
                  <div className="text-right text-[1.05em] font-bold tabular-nums">{fmtMoney(f.amount)}</div>
                </div>
              ))}

              {/* Coverage: one cell per month this invoice pays for. */}
              {cells && showSubscription ? (
                <div className="mt-4">
                  <Eyebrow className="text-brand-navy/50">Coverage</Eyebrow>
                  <div
                    className="mt-1.5 grid gap-1"
                    style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}
                  >
                    {cells.map((cell, i) => (
                      <div
                        key={i}
                        className={`rounded-md py-1.5 text-center text-[0.7em] font-bold ${
                          cell.part ? "border border-dashed border-brand-teal text-brand-navy/70" : "bg-brand-teal text-brand-navy"
                        }`}
                      >
                        {cell.label}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* ---- Payments + how to pay (left) · totals (right) ---- */}
            <div className="mt-8 grid grid-cols-[1fr_minmax(0,44%)] items-start gap-8">
              <div className="space-y-6">
                {inv.payments.length > 0 ? (
                  <div>
                    <Eyebrow>Payments received</Eyebrow>
                    <table className="mt-1.5 w-full border-collapse text-[0.85em]">
                      <thead>
                        <tr className="border-b border-brand-navy/20 text-left text-[0.85em] uppercase tracking-wide text-brand-navy/55">
                          <th className="py-1.5 font-semibold">Date</th>
                          <th className="py-1.5 font-semibold">Method</th>
                          <th className="py-1.5 font-semibold">Reference</th>
                          <th className="py-1.5 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.payments.map((p, i) => (
                          <tr key={i} className="border-b border-brand-navy/[0.07]">
                            <td className="py-1.5">{fmtDate(p.occurredAt)}</td>
                            <td className="py-1.5">
                              {p.kind === "refund"
                                ? "Refund"
                                : p.kind === "credit"
                                  ? "Credit"
                                  : p.method
                                    ? vocabularyLabel("payment_methods", p.method)
                                    : "—"}
                            </td>
                            <td className="py-1.5">{p.reference ?? "—"}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {p.kind === "refund" ? `− ${fmtMoney(p.amount)}` : fmtMoney(p.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="flex items-start gap-5">
                  <div className="flex-1 border-l-[3px] border-brand-teal pl-3">
                    <Eyebrow>{status.balance > 0 ? "How to pay" : "Payment"}</Eyebrow>
                    <div className="mt-1 space-y-1 text-[0.86em] leading-relaxed text-black/70">
                      {status.balance > 0 ? (
                        <p>
                          Please pay <span className="font-bold text-brand-navy">{fmtMoney(status.balance)}</span>
                          {inv.dueOn ? ` by ${formatIsoDay(inv.dueOn)}` : ""} and quote invoice{" "}
                          <span className="font-bold text-brand-navy">{inv.label}</span> with your payment.
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
                  {paid ? <PaidSeal on={settledOn} /> : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-[0.9em] border border-brand-navy/10">
                <div className="space-y-2 px-4 py-3.5 text-[0.9em]">
                  {inv.feeLines.length > 0 && showSubscription ? (
                    <>
                      <TotalRow label="Subscription" value={fmtMoney(inv.subscriptionAmount)} />
                      <TotalRow label="One-time fees" value={fmtMoney(inv.amount - inv.subscriptionAmount)} />
                    </>
                  ) : null}
                  {hasTax ? (
                    <>
                      <TotalRow label="Subtotal" value={fmtMoney(inv.amount)} />
                      <TotalRow label={taxName} value={fmtMoney(inv.taxAmount)} />
                    </>
                  ) : null}
                  <TotalRow label="Total" value={fmtMoney(inv.total)} bold />
                  <TotalRow label="Amount paid" value={inv.paid > 0 ? `− ${fmtMoney(inv.paid)}` : fmtMoney(0)} />
                  {status.overpaid > 0 ? <TotalRow label="Paid in excess" value={fmtMoney(status.overpaid)} /> : null}
                </div>
                <div className={`flex items-center justify-between px-4 py-3 ${status.balance > 0 ? "bg-brand-navy text-white" : "bg-brand-teal text-brand-navy"}`}>
                  <span className="text-[0.75em] font-bold uppercase tracking-[0.16em] opacity-80">Balance due</span>
                  <span className="text-[1.4em] font-extrabold tabular-nums">{fmtMoney(status.balance)}</span>
                </div>
              </div>
            </div>

            {/* ---- Foot: pinned to the bottom of the page by the column's min-height ---- */}
            <div className="mt-auto pt-8">
              <div className="flex items-end justify-between gap-6 text-[0.8em]">
                <div>
                  <div className="text-[1.5em] font-extrabold tracking-tight">Thank you.</div>
                  <div className="text-black/55">For trusting FlexicaAI with your clinic.</div>
                </div>
                <div className="text-right text-black/55">
                  <div className="font-semibold text-brand-navy">{BRAND_WEBSITE}</div>
                  <div>
                    {phone}
                    {email ? ` · ${email}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full">
                <div className="w-[62%] bg-brand-navy" />
                <div className="w-[26%] bg-brand-teal" />
                <div className="flex-1 bg-brand-teal/40" />
              </div>
            </div>
          </div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}

function Line({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="mt-[0.2em] size-3 shrink-0 text-brand-teal" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : "text-black/70"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
