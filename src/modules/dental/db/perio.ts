import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import type { ModulePerio } from "@/core/types/module";
import { perioExams, type PerioExam, type PerioTeeth } from "@/modules/dental/db/schema";
import { computeBop, examStats } from "@/modules/dental/perio-logic";

/**
 * Periodontal exams — MODULE data layer (server-only). Perio is re-measured
 * wholesale each visit, so each row is a full snapshot; "current perio" = the latest
 * exam. All clinic-scoped.
 */

/** The patient's most recent perio exam, or null. */
export async function getLatestPerio(clinicId: string, patientId: string): Promise<PerioExam | null> {
  const [row] = await db
    .select()
    .from(perioExams)
    .where(
      byClinic(
        perioExams.clinicId,
        clinicId,
        notDeleted(perioExams.deletedAt),
        eq(perioExams.patientId, patientId),
      ),
    )
    .orderBy(desc(perioExams.examDate))
    .limit(1);
  return row ?? null;
}

/** A patient's perio exams, newest first (live only). */
export async function listPerioExams(clinicId: string, patientId: string): Promise<PerioExam[]> {
  return db
    .select()
    .from(perioExams)
    .where(
      byClinic(
        perioExams.clinicId,
        clinicId,
        notDeleted(perioExams.deletedAt),
        eq(perioExams.patientId, patientId),
      ),
    )
    .orderBy(desc(perioExams.examDate));
}

/**
 * Record a new perio exam (a full snapshot). Computes BOP% from the chart. Each save
 * is a new exam (perio is periodic), so the timeline shows the trend.
 */
export async function savePerioExam(
  clinicId: string,
  input: { patientId: string; visitId?: string | null; teeth: PerioTeeth; note?: string | null },
  actor: { id: string; name: string },
): Promise<{ id: string }> {
  const teeth = input.teeth ?? {};
  const [row] = await db
    .insert(perioExams)
    .values({
      clinicId,
      patientId: input.patientId,
      visitId: input.visitId ?? null,
      teeth,
      bopPercent: computeBop(teeth),
      note: input.note?.slice(0, 500) ?? null,
      chartedBy: actor.id,
      chartedByName: actor.name,
    })
    .returning({ id: perioExams.id });
  return { id: row.id };
}

/** Soft-delete a perio exam (correction). */
export async function softDeletePerioExam(
  clinicId: string,
  examId: string,
  actorId: string,
): Promise<boolean> {
  const res = await db
    .update(perioExams)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        perioExams.clinicId,
        clinicId,
        notDeleted(perioExams.deletedAt),
        eq(perioExams.id, examId),
      ),
    )
    .returning({ id: perioExams.id });
  return res.length > 0;
}

export type PerioTrendPoint = {
  examDate: Date;
  bop: number;
  maxPocket: number;
  sitesOver5: number;
  chartedTeeth: number;
};

/** Per-exam perio summaries over time (oldest→newest) for the trend on the timeline. */
export async function perioTrend(clinicId: string, patientId: string): Promise<PerioTrendPoint[]> {
  const exams = await listPerioExams(clinicId, patientId);
  return exams
    .map((e) => ({ examDate: e.examDate, ...examStats((e.teeth ?? {}) as PerioTeeth) }))
    .reverse();
}

/** The dental `ModulePerio` bundle for the clinical-record contract. */
export const dentalPerio: ModulePerio = {
  loadLatest: async (clinicId, patientId) =>
    ((await getLatestPerio(clinicId, patientId))?.teeth ?? {}) as unknown,
  saveExam: async (clinicId, patientId, exam, actor) => {
    await savePerioExam(
      clinicId,
      { patientId, teeth: (exam.teeth ?? {}) as PerioTeeth, note: exam.note ?? null },
      actor,
    );
  },
  trend: async (clinicId, patientId) =>
    (await perioTrend(clinicId, patientId)).map((p) => ({
      examDate: p.examDate,
      bop: p.bop,
      maxPocket: p.maxPocket,
    })),
};
