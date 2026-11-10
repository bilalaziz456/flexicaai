/**
 * Subscription invoice status — PURE (no DB, no `server-only`), so the invoice list,
 * the clinic's billing card and the printed invoice all say the same thing.
 *
 * An invoice is paid by the payments recorded AGAINST it (`clinic_payments.invoice_id`,
 * owner's call 2026-11-11), never by the clinic's balance: money a clinic paid for a
 * month nobody invoiced must not quietly settle an invoice for a different month.
 * A refund recorded against an invoice takes its money back off it; a credit counts,
 * as it does on the balance (`signedBalanceAmount`).
 */

export type InvoicePaidState = "paid" | "partly_paid" | "unpaid";

export type InvoiceStatus = {
  state: InvoicePaidState;
  /** Not fully paid, and past its due date. */
  overdue: boolean;
  /** What is still owed on this invoice (never negative). */
  balance: number;
  /** Paid beyond the amount (shown, never hidden: it is money to explain). */
  overpaid: number;
};

/** YYYY-MM-DD of a local date — the shape `due_on` is stored and compared in. */
export function localIsoDate(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * Tax on an invoice: `amount` (before tax) × `rate`%, rounded to the rupee. The one
 * formula — the issue form's preview, the server that stores `tax_amount`, and the
 * printout all use it. Null/zero/invalid rate = no tax.
 */
export function invoiceTax(amount: number, rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((Math.max(0, amount) * rate) / 100);
}

/** "16" / "16.00" / "4.5" → "16" / "16" / "4.5" — a rate as a person writes it. */
export function formatRate(rate: number | string): string {
  const n = Number(rate);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(rate);
}

/** A tax as the "Add tax" fields hold it: its name and its rate in percent. */
export type InvoiceTaxRate = { label: string; rate: number };

/** The tax for each province a clinic can be in, keyed by ProvinceCode. */
export type ProvinceTaxMap = Partial<Record<string, InvoiceTaxRate>>;

/**
 * Which tax an invoice to this clinic starts from: its province's entry, or the
 * company default when the clinic has no province or the province has no rate typed
 * (sales tax on services is provincial — PRA, SRB, KPRA, BRA, FBR for Islamabad).
 * `fromProvince` says which one was used, so the form can say so.
 */
export function taxForProvince(
  provinceTax: ProvinceTaxMap,
  province: string | null | undefined,
  fallback: InvoiceTaxRate,
): InvoiceTaxRate & { fromProvince: boolean } {
  const own = province ? provinceTax[province] : undefined;
  if (own && own.rate > 0) return { label: own.label || fallback.label, rate: own.rate, fromProvince: true };
  return { ...fallback, fromProvince: false };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-11-04" → "4 Nov 2026". Parsed by hand, never through `new Date(iso)`, which
 * reads a bare date as UTC midnight and so prints the day before anywhere west of it.
 * The printed invoice showed raw ISO dates until 2026-11-11.
 */
export function formatIsoDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** An invoice's period in words, or null when it has none. */
export function formatPeriod(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatIsoDay(start)} – ${formatIsoDay(end)}`;
  if (start) return `From ${formatIsoDay(start)}`;
  if (end) return `Until ${formatIsoDay(end)}`;
  return null;
}

/**
 * @param paid   Σ payments + credits − refunds recorded against the invoice.
 * @param dueOn  `YYYY-MM-DD`, or null for an invoice with no due date (never overdue).
 * @param today  `YYYY-MM-DD`. A due date of today is not yet overdue.
 */
export function invoiceStatus(amount: number, paid: number, dueOn: string | null, today: string): InvoiceStatus {
  const balance = Math.max(0, amount - paid);
  const overpaid = Math.max(0, paid - amount);
  // A zero-amount invoice owes nothing, so it is paid on issue.
  const state: InvoicePaidState = balance === 0 ? "paid" : paid > 0 ? "partly_paid" : "unpaid";
  const overdue = state !== "paid" && dueOn !== null && dueOn < today;
  return { state, overdue, balance, overpaid };
}

/** The words a person reads — one place, so a list and a printout never differ. */
export function invoiceStatusLabel(s: InvoiceStatus): string {
  if (s.state === "paid") return "Paid";
  if (s.overdue) return s.state === "partly_paid" ? "Partly paid · overdue" : "Overdue";
  return s.state === "partly_paid" ? "Partly paid" : "Unpaid";
}

/** Badge tone for the label above. */
export function invoiceStatusTone(s: InvoiceStatus): "success" | "warning" | "destructive" | "secondary" {
  if (s.state === "paid") return "success";
  if (s.overdue) return "destructive";
  return s.state === "partly_paid" ? "warning" : "secondary";
}

/**
 * The status filter on the invoice list. `unpaid` means "still owes something" —
 * partly paid and overdue included — because that is the question it answers: which
 * invoices are not settled yet.
 */
export const INVOICE_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "unpaid", label: "Not fully paid" },
  { value: "overdue", label: "Overdue" },
  { value: "partly", label: "Partly paid" },
  { value: "paid", label: "Paid" },
] as const;

export type InvoiceStatusFilter = Exclude<(typeof INVOICE_STATUS_FILTERS)[number]["value"], "">;

export function isInvoiceStatusFilter(v: string | undefined): v is InvoiceStatusFilter {
  return v === "unpaid" || v === "overdue" || v === "partly" || v === "paid";
}
