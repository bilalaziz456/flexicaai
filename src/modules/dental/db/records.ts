import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  dentalCharts,
  dentalRecords,
  type ChartTeeth,
  type ToothFinding,
  type ToothProcedure,
} from "@/modules/dental/db/schema";
import { reduceChart } from "@/modules/dental/chart-logic";

/**
 * Dental records + living chart — MODULE data layer (server-only). The living
 * `dental_charts` is always recomputed from the patient's LIVE records after any
 * write, so it can never drift (mirrors the Sales re-snapshot pattern). All
 * clinic-scoped.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The living odontogram for a patient (or {} if none charted yet). */
export async function getPatientChart(
  clinicId: string,
  patientId: string,
): Promise<ChartTeeth> {
  const [row] = await db
    .select({ teeth: dentalCharts.teeth })
    .from(dentalCharts)
    .where(byClinic(dentalCharts.clinicId, clinicId, eq(dentalCharts.patientId, patientId)))
    .limit(1);
  return (row?.teeth ?? {}) as ChartTeeth;
}

/** A patient's dental records, newest first (baseline included). Live only. */
export async function listDentalRecords(clinicId: string, patientId: string) {
  return db
    .select()
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .orderBy(desc(dentalRecords.isBaseline), desc(dentalRecords.createdAt));
}

/** The dental record attached to a visit, if any (live). */
export async function getRecordForVisit(clinicId: string, visitId: string) {
  const [row] = await db
    .select()
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.visitId, visitId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Recompute + upsert the living chart from the patient's LIVE records (baseline
 * first, then oldest→newest). Call inside the same transaction as any record write.
 */
export async function recomputeChart(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<void> {
  const rows = await tx
    .select({
      chartAfter: dentalRecords.chartAfter,
      isBaseline: dentalRecords.isBaseline,
      createdAt: dentalRecords.createdAt,
    })
    .from(dentalRecords)
    .where(
      byClinic(
        dentalRecords.clinicId,
        clinicId,
        notDeleted(dentalRecords.deletedAt),
        eq(dentalRecords.patientId, patientId),
      ),
    )
    .orderBy(asc(dentalRecords.createdAt));

  const teeth = reduceChart(
    rows.map((r) => ({
      chartAfter: r.chartAfter,
      isBaseline: r.isBaseline,
      at: r.createdAt.getTime(),
    })),
  );

  await tx
    .insert(dentalCharts)
    .values({ clinicId, patientId, teeth })
    .onConflictDoUpdate({
      target: dentalCharts.patientId,
      set: { teeth, updatedAt: new Date() },
    });
}

export type SaveDentalRecordInput = {
  patientId: string;
  visitId?: string | null;
  isBaseline?: boolean;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
  findings?: ToothFinding[] | null;
  proceduresDone?: ToothProcedure[] | null;
  chartAfter: ChartTeeth;
};

/**
 * Upsert a patient's dental record (per visit, or the baseline) and re-fold the
 * living chart — atomic. A visit's record is keyed by `visitId`; the baseline by
 * `(patient, is_baseline)`. Used by the visit-approval hook and the intake baseline.
 */
export async function saveDentalRecord(
  clinicId: string,
  input: SaveDentalRecordInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // Find the existing record to update (per-visit, or the live baseline).
    const existing = input.visitId
      ? await tx
          .select({ id: dentalRecords.id })
          .from(dentalRecords)
          .where(
            byClinic(
              dentalRecords.clinicId,
              clinicId,
              notDeleted(dentalRecords.deletedAt),
              eq(dentalRecords.visitId, input.visitId),
            ),
          )
          .limit(1)
      : input.isBaseline
        ? await tx
            .select({ id: dentalRecords.id })
            .from(dentalRecords)
            .where(
              byClinic(
                dentalRecords.clinicId,
                clinicId,
                notDeleted(dentalRecords.deletedAt),
                eq(dentalRecords.isBaseline, true),
                eq(dentalRecords.patientId, input.patientId),
              ),
            )
            .limit(1)
        : [];

    const values = {
      chiefComplaint: input.chiefComplaint ?? null,
      diagnosis: input.diagnosis ?? null,
      findings: input.findings ?? null,
      proceduresDone: input.proceduresDone ?? null,
      chartAfter: input.chartAfter,
      updatedAt: new Date(),
    };

    let id: string;
    if (existing[0]) {
      await tx
        .update(dentalRecords)
        .set(values)
        .where(eq(dentalRecords.id, existing[0].id));
      id = existing[0].id;
    } else {
      const [row] = await tx
        .insert(dentalRecords)
        .values({
          clinicId,
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          isBaseline: input.isBaseline ?? false,
          ...values,
        })
        .returning({ id: dentalRecords.id });
      id = row.id;
    }

    await recomputeChart(tx, clinicId, input.patientId);
    return { id };
  });
}

/** Soft-delete a dental record and re-fold the chart (correction / discard). */
export async function softDeleteDentalRecord(
  clinicId: string,
  recordId: string,
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: dentalRecords.id, patientId: dentalRecords.patientId })
      .from(dentalRecords)
      .where(
        byClinic(
          dentalRecords.clinicId,
          clinicId,
          notDeleted(dentalRecords.deletedAt),
          eq(dentalRecords.id, recordId),
        ),
      )
      .limit(1);
    if (!row) return false;
    await tx
      .update(dentalRecords)
      .set(softDeleteValues(actorId, newDeleteGroup()))
      .where(and(eq(dentalRecords.clinicId, clinicId), eq(dentalRecords.id, recordId)));
    await recomputeChart(tx, clinicId, row.patientId);
    return true;
  });
}
