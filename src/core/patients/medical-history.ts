import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patientMedicalHistory } from "@/core/db/schema";
import {
  asMedicalHistory,
  type Allergy,
  type MedicalHistoryData,
} from "@/core/lib/medical-history";

/**
 * Patient medical & dental history — CORE data layer (server-only). One row per
 * patient (the latest snapshot); clinic-scoped. See core/lib/medical-history.ts for
 * the shape + the allergy gate.
 */

export type MedicalHistory = MedicalHistoryData & {
  updatedByName: string | null;
  updatedAt: Date | null;
};

/** The patient's medical history (empty defaults when none recorded yet). */
export async function getMedicalHistory(
  clinicId: string,
  patientId: string,
): Promise<MedicalHistory> {
  const [row] = await db
    .select()
    .from(patientMedicalHistory)
    .where(byClinic(patientMedicalHistory.clinicId, clinicId, eq(patientMedicalHistory.patientId, patientId)))
    .limit(1);
  const data = asMedicalHistory(row ?? {});
  return { ...data, updatedByName: row?.updatedByName ?? null, updatedAt: row?.updatedAt ?? null };
}

/** Just the patient's allergies — for the allergy banner (cheap). */
export async function getPatientAllergies(clinicId: string, patientId: string): Promise<Allergy[]> {
  const [row] = await db
    .select({ allergies: patientMedicalHistory.allergies })
    .from(patientMedicalHistory)
    .where(byClinic(patientMedicalHistory.clinicId, clinicId, eq(patientMedicalHistory.patientId, patientId)))
    .limit(1);
  return (row?.allergies ?? []) as Allergy[];
}

/** Upsert the patient's medical history (replace-all; one row per patient). */
export async function saveMedicalHistory(
  clinicId: string,
  patientId: string,
  input: MedicalHistoryData,
  actor: { id: string; name: string },
): Promise<void> {
  const data = asMedicalHistory(input);
  const values = {
    allergies: data.allergies,
    conditions: data.conditions,
    medications: data.medications,
    smoking: data.smoking?.slice(0, 200) || null,
    alcohol: data.alcohol?.slice(0, 200) || null,
    notes: data.notes?.slice(0, 2000) || null,
    updatedBy: actor.id,
    updatedByName: actor.name,
    updatedAt: new Date(),
  };
  await db
    .insert(patientMedicalHistory)
    .values({ clinicId, patientId, ...values })
    .onConflictDoUpdate({ target: patientMedicalHistory.patientId, set: values });
}
