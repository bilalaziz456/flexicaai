import { formatPkr } from "@/core/appointments/fee";
import { formatDateTime12h } from "@/core/lib/date-time";

/** One money movement on a visit, already labelled by the caller (the method label
 *  comes from the vocabulary cache, which this presentational file must not read). */
export type PaymentHistoryEntry = {
  id: string;
  /** payment · advance_applied · refund (an unallocated `advance` is not on a visit). */
  kind: string;
  amount: number;
  occurredAt: Date;
  methodLabel: string | null;
  note: string | null;
};

const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  advance_applied: "Advance applied",
  refund: "Refund",
  opening: "Opening balance",
};

/**
 * The complete payment history on a printed invoice or receipt (owner's call,
 * 2026-10-12): every payment and refund in the order it happened, with what was still
 * due after each — "bill 4,000 · paid 2,000 → 2,000 due · paid 2,000 → 0 · refund
 * 1,000 → 1,000 · paid 1,000 → 0". The running figure is worked out from the bill and
 * the entries themselves, so the last line always equals the Due/Outstanding total
 * printed under it.
 *
 * Two lines per entry rather than a four-column table (owner's report, 2026-10-18):
 * on an 80mm receipt the table squeezed the date into the details ("3:24 AMRefund")
 * and broke amounts across lines ("−Rs / 29,700"). What it is and how much on the
 * first line, when and what was left due on the second, fits every paper size.
 */
export function PaymentHistoryPrint({ bill, entries }: { bill: number; entries: PaymentHistoryEntry[] }) {
  if (entries.length === 0) return null;
  const ordered = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  // What was still due after each entry: a payment lowers it, a refund raises it.
  const dueAfter = ordered.reduce<number[]>((acc, e) => {
    const before = acc.length ? acc[acc.length - 1] : bill;
    acc.push(before + (e.kind === "refund" ? e.amount : -e.amount));
    return acc;
  }, []);
  return (
    <section className="mt-4 break-inside-avoid-page">
      <h3 className="mb-1 text-[0.72em] font-semibold tracking-[0.14em] uppercase opacity-60">Payment history</h3>
      <ol className="border-t border-black/15">
        <li className="flex items-baseline justify-between gap-3 border-b border-black/10 py-1.5">
          <span className="font-medium">Bill</span>
          <span className="whitespace-nowrap tabular-nums">{formatPkr(bill)}</span>
        </li>
        {ordered.map((e, i) => {
          const out = e.kind === "refund";
          return (
            // The last row has no rule of its own: the footer's line follows it, and two
            // lines one above the other read as a mistake.
            <li key={e.id} className="border-b border-black/10 py-1.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  {e.methodLabel ? <span className="opacity-60"> · {e.methodLabel}</span> : null}
                </span>
                <span className={`whitespace-nowrap tabular-nums ${out ? "" : "font-medium"}`}>
                  {out ? "−" : ""}
                  {formatPkr(e.amount)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[0.85em] opacity-60">
                <span className="whitespace-nowrap">{formatDateTime12h(e.occurredAt)}</span>
                <span className="whitespace-nowrap tabular-nums">Due {formatPkr(Math.max(0, dueAfter[i]))}</span>
              </div>
              {e.note ? <div className="text-[0.85em] opacity-60">{e.note}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
