import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { doctorPayouts, expenses, patientPayments } from "@/core/db/schema";
import {
  normalizePaymentMethod,
  paymentMethodOrder,
} from "@/core/finance/payment-methods";
import { report } from "@/core/observability";

/**
 * Day book (Finance) — the day's cash movement by method, for end-of-day
 * reconciliation. Money IN = patient payments/advances collected that day; money
 * OUT = refunds + expenses + DOCTOR PAYOUTS recorded that day. Net per method =
 * in − out. Clinic-scoped. Payments key off `occurred_at`, expenses off
 * `incurred_on`, payouts off `created_at` (the table has no separate occurrence
 * date — `period_start`/`period_end` describe what a payout COVERS, not when the
 * money left, so the recorded time is the right one for a cash book).
 *
 * Payouts are their own column, deliberately NOT folded into `expenses`: nothing
 * writes a payout into the expenses ledger, so adding it there would make this
 * report's expenses figure disagree with the Expenses report for no visible reason.
 */
export type DayBookRow = {
  method: string;
  collected: number;
  refunded: number;
  expenses: number;
  payouts: number;
  net: number;
};

export type CashSummary = {
  rows: DayBookRow[];
  totals: { collected: number; refunded: number; expenses: number; payouts: number; net: number };
};
export type DayBook = CashSummary & { date: string };

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Aggregate payment + expense rows into per-method cash rows + totals. Exported for
 * `scripts/test-daybook-kinds.ts`, which asserts every kind the DB permits is
 * classified here — pure in and out, so it needs no fixtures.
 */
export function aggregateCash(
  payRows: { kind: string; method: string | null; amount: number }[],
  expRows: { method: string | null; amount: number }[],
  payoutRows: { method: string | null; amount: number }[],
): CashSummary {
  const map = new Map<string, DayBookRow>();
  const row = (m: string): DayBookRow => {
    let r = map.get(m);
    if (!r) {
      r = { method: m, collected: 0, refunded: 0, expenses: 0, payouts: 0, net: 0 };
      map.set(m, r);
    }
    return r;
  };
  for (const p of payRows) {
    const r = row(normalizePaymentMethod(p.method));
    // EXHAUSTIVE on purpose: every kind is named and the default is loud. This used to
    // be an allow-list that silently ignored anything it didn't recognise, which is how
    // 'opening' — cash taken against an imported opening balance, a real fifth kind —
    // ended up in neither the collected nor the refunded column, so the day book simply
    // did not show money that was in the drawer. A kind added later must be classified
    // here rather than quietly vanishing again.
    switch (p.kind) {
      case "refund":
        r.refunded += p.amount;
        break;
      case "payment":
      case "advance":
      case "opening":
      case "advance_applied":
        // NOTE on 'advance_applied': this is stored credit being consumed by a bill, so
        // no tender moves — the cash was already counted on the day the 'advance' was
        // taken. Counting it here therefore DOUBLE-COUNTS that money in a report whose
        // stated job is end-of-day cash reconciliation. It is left in the collected
        // column for now because removing it changes a figure the clinic already reads;
        // that is an owner's decision, not a refactor. Its rows carry method='advance',
        // so they are distinguishable if the decision goes the other way.
        r.collected += p.amount;
        break;
      default:
        report(new Error(`unclassified patient_payments.kind: ${p.kind}`), {
          op: "finance.daybook.unknownKind",
        });
    }
  }
  for (const e of expRows) row(normalizePaymentMethod(e.method)).expenses += e.amount;
  // A doctor's share leaving the drawer is cash out like any other. It used to be
  // absent entirely — `recordPayout` writes only to `doctor_payouts` and no expense
  // row, so a payout cycle left the report claiming more cash on hand than there was.
  for (const p of payoutRows) row(normalizePaymentMethod(p.method)).payouts += p.amount;

  const rows = [...map.values()]
    .map((r) => ({ ...r, net: r.collected - r.refunded - r.expenses - r.payouts }))
    .sort((a, b) => paymentMethodOrder(a.method) - paymentMethodOrder(b.method));
  const totals = rows.reduce(
    (t, r) => ({
      collected: t.collected + r.collected,
      refunded: t.refunded + r.refunded,
      expenses: t.expenses + r.expenses,
      payouts: t.payouts + r.payouts,
      net: t.net + r.net,
    }),
    { collected: 0, refunded: 0, expenses: 0, payouts: 0, net: 0 },
  );
  return { rows, totals };
}

export async function getDayBook(clinicId: string, dayStr: string): Promise<DayBook> {
  const [y, mo, d] = dayStr.split("-").map(Number);
  const start = new Date(y, mo - 1, d);
  const end = new Date(y, mo - 1, d + 1);

  const [payRows, expRows, payoutRows] = await Promise.all([
    db
      // Pre-summed per (kind, method) in SQL — delta D-12. This used to select every
      // payment in the range so JS could fold it into at most four method buckets;
      // over a year that is the whole cash ledger in memory to produce four numbers.
      // `aggregateCash` accumulates whatever rows it is given, so pre-summing needs no
      // change there at all.
      .select({ kind: patientPayments.kind, method: patientPayments.method, amount: sql<number>`sum(${patientPayments.amount})::int` })
      .from(patientPayments)
      .groupBy(patientPayments.kind, patientPayments.method)
      .where(
        byClinic(
          patientPayments.clinicId,
          clinicId,
          notDeleted(patientPayments.deletedAt),
          and(gte(patientPayments.occurredAt, start), lt(patientPayments.occurredAt, end)),
        ),
      ),
    db
      .select({ method: expenses.method, amount: sql<number>`sum(${expenses.amount})::int` })
      .from(expenses)
      .groupBy(expenses.method)
      .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.incurredOn, dayStr))),
    // `doctor_payouts` has no soft delete — `voidPayout` removes the row outright — so
    // there is no `notDeleted()` here, and a voided payout correctly stops counting.
    db
      .select({ method: doctorPayouts.method, amount: sql<number>`sum(${doctorPayouts.amount})::int` })
      .from(doctorPayouts)
      .groupBy(doctorPayouts.method)
      .where(
        byClinic(
          doctorPayouts.clinicId,
          clinicId,
          and(gte(doctorPayouts.createdAt, start), lt(doctorPayouts.createdAt, end)),
        ),
      ),
  ]);

  return { date: dayStr, ...aggregateCash(payRows, expRows, payoutRows) };
}

/**
 * Cash movement over a RANGE (for the Overview) — same per-method rows/totals as the
 * day book, but bucketed across `[start, end)`: payments by `occurred_at`, expenses by
 * `incurred_on`. Clinic-scoped.
 */
export async function getCashSummary(
  clinicId: string,
  range: { start: Date; end: Date },
): Promise<CashSummary> {
  const [payRows, expRows, payoutRows] = await Promise.all([
    db
      // Pre-summed per (kind, method) in SQL — delta D-12. This used to select every
      // payment in the range so JS could fold it into at most four method buckets;
      // over a year that is the whole cash ledger in memory to produce four numbers.
      // `aggregateCash` accumulates whatever rows it is given, so pre-summing needs no
      // change there at all.
      .select({ kind: patientPayments.kind, method: patientPayments.method, amount: sql<number>`sum(${patientPayments.amount})::int` })
      .from(patientPayments)
      .groupBy(patientPayments.kind, patientPayments.method)
      .where(
        byClinic(
          patientPayments.clinicId,
          clinicId,
          notDeleted(patientPayments.deletedAt),
          and(gte(patientPayments.occurredAt, range.start), lt(patientPayments.occurredAt, range.end)),
        ),
      ),
    db
      .select({ method: expenses.method, amount: sql<number>`sum(${expenses.amount})::int` })
      .from(expenses)
      .groupBy(expenses.method)
      .where(
        byClinic(
          expenses.clinicId,
          clinicId,
          notDeleted(expenses.deletedAt),
          and(gte(expenses.incurredOn, isoDate(range.start)), lt(expenses.incurredOn, isoDate(range.end))),
        ),
      ),
    // No `notDeleted()` — `doctor_payouts` is not soft-deletable (voidPayout deletes).
    db
      .select({ method: doctorPayouts.method, amount: sql<number>`sum(${doctorPayouts.amount})::int` })
      .from(doctorPayouts)
      .groupBy(doctorPayouts.method)
      .where(
        byClinic(
          doctorPayouts.clinicId,
          clinicId,
          and(gte(doctorPayouts.createdAt, range.start), lt(doctorPayouts.createdAt, range.end)),
        ),
      ),
  ]);
  return aggregateCash(payRows, expRows, payoutRows);
}

/** All the raw collections, expenses + doctor payouts for a day (for the CSV export). */
export type DayBookLine = { time: string; type: string; method: string; amount: number; note: string };

export async function getDayBookLines(clinicId: string, dayStr: string): Promise<DayBookLine[]> {
  const [y, mo, d] = dayStr.split("-").map(Number);
  const start = new Date(y, mo - 1, d);
  const end = new Date(y, mo - 1, d + 1);
  const [pays, exps, payouts] = await Promise.all([
    db
      .select({ kind: patientPayments.kind, method: patientPayments.method, amount: patientPayments.amount, occurredAt: patientPayments.occurredAt, note: patientPayments.note })
      .from(patientPayments)
      .where(byClinic(patientPayments.clinicId, clinicId, notDeleted(patientPayments.deletedAt), and(gte(patientPayments.occurredAt, start), lt(patientPayments.occurredAt, end)))),
    db
      .select({ method: expenses.method, amount: expenses.amount, vendor: expenses.vendor, note: expenses.note })
      .from(expenses)
      .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.incurredOn, dayStr))),
    db
      .select({ method: doctorPayouts.method, amount: doctorPayouts.amount, doctorName: doctorPayouts.doctorName, note: doctorPayouts.note, createdAt: doctorPayouts.createdAt })
      .from(doctorPayouts)
      .where(byClinic(doctorPayouts.clinicId, clinicId, and(gte(doctorPayouts.createdAt, start), lt(doctorPayouts.createdAt, end)))),
  ]);
  const lines: DayBookLine[] = [];
  for (const p of pays) {
    lines.push({
      time: p.occurredAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      type: p.kind,
      method: normalizePaymentMethod(p.method),
      amount: p.kind === "refund" ? -p.amount : p.amount,
      note: p.note ?? "",
    });
  }
  for (const e of exps) {
    lines.push({ time: "", type: "expense", method: normalizePaymentMethod(e.method), amount: -e.amount, note: e.vendor ?? e.note ?? "" });
  }
  // The doctor's name is the useful note here — a payout line with no payee is not
  // reconcilable against anything.
  for (const p of payouts) {
    lines.push({
      time: p.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      type: "doctor_payout",
      method: normalizePaymentMethod(p.method),
      amount: -p.amount,
      note: p.doctorName ?? p.note ?? "",
    });
  }
  return lines;
}
