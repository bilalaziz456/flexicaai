import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { expenses, patientPayments } from "@/core/db/schema";

/**
 * Day book (Finance) — the day's cash movement by method, for end-of-day
 * reconciliation. Money IN = patient payments/advances collected that day; money
 * OUT = refunds + expenses recorded that day. Net per method = in − out.
 * Clinic-scoped. Payments key off `occurred_at`, expenses off `incurred_on`.
 */
export type DayBookRow = {
  method: string;
  collected: number;
  refunded: number;
  expenses: number;
  net: number;
};

export type DayBook = {
  date: string;
  rows: DayBookRow[];
  totals: { collected: number; refunded: number; expenses: number; net: number };
};

const METHODS = ["cash", "bank", "cheque", "other"];
const normMethod = (m: string | null): string => (m && METHODS.includes(m) ? m : "other");

export async function getDayBook(clinicId: string, dayStr: string): Promise<DayBook> {
  const [y, mo, d] = dayStr.split("-").map(Number);
  const start = new Date(y, mo - 1, d);
  const end = new Date(y, mo - 1, d + 1);

  const [payRows, expRows] = await Promise.all([
    db
      .select({ kind: patientPayments.kind, method: patientPayments.method, amount: patientPayments.amount })
      .from(patientPayments)
      .where(
        byClinic(
          patientPayments.clinicId,
          clinicId,
          notDeleted(patientPayments.deletedAt),
          and(gte(patientPayments.occurredAt, start), lt(patientPayments.occurredAt, end)),
        ),
      ),
    db
      .select({ method: expenses.method, amount: expenses.amount })
      .from(expenses)
      .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.incurredOn, dayStr))),
  ]);

  const map = new Map<string, DayBookRow>();
  const row = (m: string): DayBookRow => {
    let r = map.get(m);
    if (!r) {
      r = { method: m, collected: 0, refunded: 0, expenses: 0, net: 0 };
      map.set(m, r);
    }
    return r;
  };
  for (const p of payRows) {
    const r = row(normMethod(p.method));
    if (p.kind === "refund") r.refunded += p.amount;
    else if (p.kind === "payment" || p.kind === "advance" || p.kind === "advance_applied") r.collected += p.amount;
  }
  for (const e of expRows) row(normMethod(e.method)).expenses += e.amount;

  const rows = [...map.values()]
    .map((r) => ({ ...r, net: r.collected - r.refunded - r.expenses }))
    .sort((a, b) => METHODS.indexOf(a.method) - METHODS.indexOf(b.method));

  const totals = rows.reduce(
    (t, r) => ({
      collected: t.collected + r.collected,
      refunded: t.refunded + r.refunded,
      expenses: t.expenses + r.expenses,
      net: t.net + r.net,
    }),
    { collected: 0, refunded: 0, expenses: 0, net: 0 },
  );

  return { date: dayStr, rows, totals };
}

/** All the raw collections + expenses for a day (for the CSV export). */
export type DayBookLine = { time: string; type: string; method: string; amount: number; note: string };

export async function getDayBookLines(clinicId: string, dayStr: string): Promise<DayBookLine[]> {
  const [y, mo, d] = dayStr.split("-").map(Number);
  const start = new Date(y, mo - 1, d);
  const end = new Date(y, mo - 1, d + 1);
  const [pays, exps] = await Promise.all([
    db
      .select({ kind: patientPayments.kind, method: patientPayments.method, amount: patientPayments.amount, occurredAt: patientPayments.occurredAt, note: patientPayments.note })
      .from(patientPayments)
      .where(byClinic(patientPayments.clinicId, clinicId, notDeleted(patientPayments.deletedAt), and(gte(patientPayments.occurredAt, start), lt(patientPayments.occurredAt, end)))),
    db
      .select({ method: expenses.method, amount: expenses.amount, vendor: expenses.vendor, note: expenses.note })
      .from(expenses)
      .where(byClinic(expenses.clinicId, clinicId, notDeleted(expenses.deletedAt), eq(expenses.incurredOn, dayStr))),
  ]);
  const lines: DayBookLine[] = [];
  for (const p of pays) {
    lines.push({
      time: p.occurredAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      type: p.kind,
      method: normMethod(p.method),
      amount: p.kind === "refund" ? -p.amount : p.amount,
      note: p.note ?? "",
    });
  }
  for (const e of exps) {
    lines.push({ time: "", type: "expense", method: normMethod(e.method), amount: -e.amount, note: e.vendor ?? e.note ?? "" });
  }
  return lines;
}
