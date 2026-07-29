import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { importBatches, importedTransactions, patients, procedures, visits } from "@/core/db/schema";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import type { ImportEntity } from "./types";

export type BatchRow = {
  id: string;
  entity: string;
  filename: string | null;
  counts: Record<string, number>;
  status: string;
  createdByName: string | null;
  createdAt: Date;
};

/** Import history for a clinic, newest first. */
export async function listBatches(clinicId: string): Promise<BatchRow[]> {
  return db
    .select({
      id: importBatches.id,
      entity: importBatches.entity,
      filename: importBatches.filename,
      counts: importBatches.counts,
      status: importBatches.status,
      createdByName: importBatches.createdByName,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(eq(importBatches.clinicId, clinicId))
    .orderBy(desc(importBatches.createdAt));
}

// Each import entity → the table its rows live in. The four financial-archive passes
// all write the ONE `imported_transactions` table, so undo soft-deletes by batch there.
const TABLE = {
  patients,
  procedures,
  visits,
  fin_invoice: importedTransactions,
  fin_payment: importedTransactions,
  fin_expense: importedTransactions,
  fin_payout: importedTransactions,
} as const;

/**
 * Undo an import — soft-deletes every LIVE row the batch created (one delete group)
 * and marks the batch `undone`. Idempotent (a second call no-ops). We deliberately do
 * NOT roll `clinics.next_mrn` back: gaps are harmless and never reusing a number keeps
 * the MRN unique index collision-free. Clinic-scoped.
 */
export async function undoBatch(
  clinicId: string,
  batchId: string,
  actor: { id: string },
): Promise<boolean> {
  const [batch] = await db
    .select({ entity: importBatches.entity, status: importBatches.status })
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.clinicId, clinicId)))
    .limit(1);
  if (!batch || batch.status !== "active") return false;

  const table = TABLE[batch.entity as ImportEntity];
  if (!table) return false;

  const sd = softDeleteValues(actor.id, newDeleteGroup(), false);
  await db
    .update(table)
    .set(sd)
    .where(and(eq(table.clinicId, clinicId), eq(table.importBatchId, batchId), isNull(table.deletedAt)));
  await db
    .update(importBatches)
    .set({ status: "undone" })
    .where(and(eq(importBatches.clinicId, clinicId), eq(importBatches.id, batchId)));
  return true;
}
