import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  discountSettlements,
  patients,
  recalls,
  saleShares,
  sales,
  visits,
} from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";

/** The fields a clinic edits on a patient. Age is stored as a derived birth date. */
export type PatientInput = {
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  reference: string | null;
  dataConsent: boolean;
};

/**
 * Registers a patient and allocates their per-clinic MRN — CORE per ADR-014.
 *
 * The MRN is taken by LOCKING the clinic row (`FOR UPDATE`) inside the same
 * transaction as the insert, mirroring invoice and receipt numbering. Without the
 * lock two registrations racing would read the same `next_mrn` and both use it, and
 * an MRN is the number a clinic writes on a physical file — a duplicate is not a
 * cosmetic problem.
 */
export async function createPatient(
  clinicId: string,
  input: PatientInput,
): Promise<{ id: string; mrn: number }> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ nextMrn: clinics.nextMrn })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for("update")
      .limit(1);
    const mrn = c?.nextMrn ?? 1;
    await tx
      .update(clinics)
      .set({ nextMrn: mrn + 1, updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));

    const [row] = await tx
      .insert(patients)
      .values({ clinicId, mrn, ...input })
      .returning({ id: patients.id });
    return { id: row.id, mrn };
  });
}

/** Edits a patient. Returns false when the id is not this clinic's (or is trashed). */
export async function updatePatient(
  clinicId: string,
  patientId: string,
  input: PatientInput,
): Promise<boolean> {
  const rows = await db
    .update(patients)
    .set({ ...input, updatedAt: new Date() })
    .where(
      byClinic(
        patients.clinicId,
        clinicId,
        notDeleted(patients.deletedAt),
        eq(patients.id, patientId),
      ),
    )
    .returning({ id: patients.id });
  return rows.length > 0;
}

/**
 * Trashes a patient and cascade-hides their appointments, visits and recalls under
 * ONE delete group, so Restore brings back exactly this batch (ADR-006).
 *
 * Two details carry the design:
 *
 * - The cascade only touches rows that are still LIVE. A child trashed independently
 *   keeps its own group, so restoring the patient does not revive something someone
 *   deliberately binned on its own.
 * - The realised-revenue rows are DELETED, not soft-deleted. `sales`, `sale_shares`
 *   and `discount_settlements` are derived state (ADR-016) that exists only for live
 *   completed appointments; they are re-snapshotted if the patient is restored, so
 *   keeping trashed copies would just be a second source of truth to disagree with.
 */
export async function softDeletePatient(
  clinicId: string,
  patientId: string,
  actorId: string,
): Promise<boolean> {
  const group = newDeleteGroup();
  const parent = softDeleteValues(actorId, group);
  const child = { ...parent, deletedByCascade: true };

  let found = true;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(patients)
      .set(parent)
      .where(
        byClinic(
          patients.clinicId,
          clinicId,
          notDeleted(patients.deletedAt),
          eq(patients.id, patientId),
        ),
      )
      .returning({ id: patients.id });
    if (!row) {
      found = false;
      return;
    }

    for (const [table, fk, deletedAt] of [
      [appointments, appointments.patientId, appointments.deletedAt],
      [visits, visits.patientId, visits.deletedAt],
      [recalls, recalls.patientId, recalls.deletedAt],
    ] as const) {
      await tx
        .update(table)
        .set(child)
        .where(byClinic(table.clinicId, clinicId, notDeleted(deletedAt), eq(fk, patientId)));
    }

    const patientApptIds = tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.patientId, patientId)));
    await tx
      .delete(sales)
      .where(and(eq(sales.clinicId, clinicId), inArray(sales.appointmentId, patientApptIds)));
    await tx
      .delete(saleShares)
      .where(and(eq(saleShares.clinicId, clinicId), inArray(saleShares.appointmentId, patientApptIds)));
    await tx
      .delete(discountSettlements)
      .where(
        and(
          eq(discountSettlements.clinicId, clinicId),
          inArray(discountSettlements.appointmentId, patientApptIds),
        ),
      );
  });
  return found;
}

/** The patient behind an id, if they belong to THIS clinic and are not trashed. */
export async function findClinicPatient(clinicId: string, patientId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)),
    )
    .limit(1);
  return row?.id ?? null;
}
