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

const when = (d: Date) => formatDateTime12h(d);

/**
 * The complete payment history on a printed invoice or receipt (owner's call,
 * 2026-10-12): every payment and refund in the order it happened, with what was still
 * due after each — "bill 4,000 · paid 2,000 → 2,000 due · paid 2,000 → 0 · refund
 * 1,000 → 1,000 · paid 1,000 → 0". The running figure is worked out from the bill and
 * the entries themselves, so the last line always equals the Due/Outstanding total
 * printed under it.
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
    <>
      <div className="mt-3 text-[0.9em] font-semibold opacity-80">Payment history</div>
      <table className="mt-1 w-full border-collapse text-[0.95em]">
        <thead>
          <tr className="border-y border-black/20 text-left">
            <th className="py-1 font-normal opacity-70">Date</th>
            <th className="py-1 font-normal opacity-70">Details</th>
            <th className="py-1 text-right font-normal opacity-70">Amount</th>
            <th className="py-1 text-right font-normal opacity-70">Balance due</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1" colSpan={2}>
              Bill
            </td>
            <td className="py-1 text-right tabular-nums">{formatPkr(bill)}</td>
            <td className="py-1 text-right tabular-nums">{formatPkr(bill)}</td>
          </tr>
          {ordered.map((e, i) => {
            const out = e.kind === "refund";
            return (
              <tr key={e.id} className="align-top">
                <td className="py-1 whitespace-nowrap">{when(e.occurredAt)}</td>
                <td className="py-1">
                  {KIND_LABEL[e.kind] ?? e.kind}
                  {e.methodLabel ? <span className="opacity-70"> · {e.methodLabel}</span> : null}
                  {e.note ? <span className="block text-[0.9em] opacity-70">{e.note}</span> : null}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {out ? "−" : ""}
                  {formatPkr(e.amount)}
                </td>
                <td className="py-1 text-right tabular-nums">{formatPkr(Math.max(0, dueAfter[i]))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
