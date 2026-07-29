import "server-only";

import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { importedTransactions } from "@/core/db/schema";

/**
 * Imported financial-history archive — CLINIC-SIDE READ-ONLY reads
 * (docs/financial-archive-plan.md). Powers `/clinic/history`. This is the ONLY reader
 * of `imported_transactions`; NO live report (sales/payments/receivables/P&L) touches
 * that table, so the archive can never pollute live figures. Clinic-scoped.
 */

export type HistoryType = "invoice" | "payment" | "expense" | "doctor_payout";

/** A tab → the stored `type` value(s) it covers (Payments folds in refunds). */
export const HISTORY_TABS: { id: HistoryType; label: string; types: string[] }[] = [
  { id: "invoice", label: "Invoices", types: ["invoice"] },
  { id: "payment", label: "Payments", types: ["payment", "refund"] },
  { id: "expense", label: "Expenses", types: ["expense"] },
  { id: "doctor_payout", label: "Doctor payouts", types: ["doctor_payout"] },
];

export type ImportedHistoryRow = {
  id: string;
  type: string;
  txnDate: string | null; // 'YYYY-MM-DD'
  amount: number;
  patientId: string | null;
  patientName: string | null;
  doctorName: string | null;
  description: string | null;
  reference: string | null;
  method: string | null;
};

export type ImportedHistoryFilters = {
  types?: string[];
  from?: string; // 'YYYY-MM-DD'
  toExclusive?: string; // 'YYYY-MM-DD'
  q?: string;
  limit?: number;
  offset?: number;
};

export type ImportedHistorySummary = {
  hasAny: boolean;
  billed: number; // Σ invoices
  collected: number; // Σ payments − Σ refunds
  outstanding: number; // billed − collected (≥ 0)
  expenses: number; // Σ expenses
  payouts: number; // Σ doctor payouts
  counts: Record<string, number>;
};

/** Grand totals across the whole archive (the landing cards). */
export async function getImportedHistorySummary(clinicId: string): Promise<ImportedHistorySummary> {
  const rows = await db
    .select({
      type: importedTransactions.type,
      total: sql<number>`coalesce(sum(${importedTransactions.amount}), 0)::int`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(importedTransactions)
    .where(byClinic(importedTransactions.clinicId, clinicId, notDeleted(importedTransactions.deletedAt)))
    .groupBy(importedTransactions.type);

  const by = (t: string) => rows.find((r) => r.type === t)?.total ?? 0;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.type] = r.cnt;
  const billed = by("invoice");
  const collected = by("payment") - by("refund");
  return {
    hasAny: rows.length > 0,
    billed,
    collected,
    outstanding: Math.max(0, billed - collected),
    expenses: by("expense"),
    payouts: by("doctor_payout"),
    counts,
  };
}

function conds(clinicId: string, f: ImportedHistoryFilters): SQL {
  const parts: SQL[] = [notDeleted(importedTransactions.deletedAt)];
  if (f.types && f.types.length) parts.push(inArray(importedTransactions.type, f.types));
  if (f.from) parts.push(gte(importedTransactions.txnDate, f.from));
  if (f.toExclusive) parts.push(lt(importedTransactions.txnDate, f.toExclusive));
  if (f.q) {
    const like = `%${f.q}%`;
    parts.push(
      or(
        ilike(importedTransactions.patientName, like),
        ilike(importedTransactions.doctorName, like),
        ilike(importedTransactions.reference, like),
        ilike(importedTransactions.description, like),
      )!,
    );
  }
  return byClinic(importedTransactions.clinicId, clinicId, and(...parts));
}

/** A filtered page of archive rows (newest first) + the matching count + amount total. */
export async function listImportedTransactions(
  clinicId: string,
  filters: ImportedHistoryFilters = {},
): Promise<{ rows: ImportedHistoryRow[]; total: number; totalAmount: number }> {
  const where = conds(clinicId, filters);
  const [rows, [{ total }], [sums]] = await Promise.all([
    db
      .select({
        id: importedTransactions.id,
        type: importedTransactions.type,
        txnDate: importedTransactions.txnDate,
        amount: importedTransactions.amount,
        patientId: importedTransactions.patientId,
        patientName: importedTransactions.patientName,
        doctorName: importedTransactions.doctorName,
        description: importedTransactions.description,
        reference: importedTransactions.reference,
        method: importedTransactions.method,
      })
      .from(importedTransactions)
      .where(where)
      .orderBy(desc(importedTransactions.txnDate), desc(importedTransactions.createdAt))
      .limit(filters.limit ?? 200)
      .offset(filters.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(importedTransactions).where(where),
    // Refunds subtract, so the total reads as net money for the payments tab.
    db
      .select({
        total: sql<number>`coalesce(sum(case when ${importedTransactions.type} = 'refund' then -${importedTransactions.amount} else ${importedTransactions.amount} end), 0)::int`,
      })
      .from(importedTransactions)
      .where(where),
  ]);
  return { rows, total: Number(total), totalAmount: Number(sums?.total ?? 0) };
}

/** Per-doctor payout totals (the archive's doctor view). */
export async function getImportedDoctorPayouts(
  clinicId: string,
): Promise<{ doctorName: string; paid: number; count: number }[]> {
  const rows = await db
    .select({
      doctorName: sql<string>`coalesce(${importedTransactions.doctorName}, '—')`,
      paid: sql<number>`coalesce(sum(${importedTransactions.amount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(importedTransactions)
    .where(
      byClinic(
        importedTransactions.clinicId,
        clinicId,
        notDeleted(importedTransactions.deletedAt),
        eq(importedTransactions.type, "doctor_payout"),
      ),
    )
    .groupBy(sql`coalesce(${importedTransactions.doctorName}, '—')`)
    .orderBy(desc(sql`sum(${importedTransactions.amount})`));
  return rows;
}
