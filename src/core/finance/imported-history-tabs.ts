/**
 * Imported-history tab config — CLIENT-SAFE (no `server-only`, no DB). Split out of
 * `imported-history.ts` (which is server-only) so client components — the filter bar,
 * the table wrapper — can import the tab list + type without pulling the DB layer into
 * the browser bundle. The server reader re-exports these.
 */
export type HistoryType = "invoice" | "payment" | "expense" | "doctor_payout";

/** A tab → the stored `type` value(s) it covers (Payments folds in refunds). */
export const HISTORY_TABS: { id: HistoryType; label: string; types: string[] }[] = [
  { id: "invoice", label: "Invoices", types: ["invoice"] },
  { id: "payment", label: "Payments", types: ["payment", "refund"] },
  { id: "expense", label: "Expenses", types: ["expense"] },
  { id: "doctor_payout", label: "Doctor payouts", types: ["doctor_payout"] },
];
