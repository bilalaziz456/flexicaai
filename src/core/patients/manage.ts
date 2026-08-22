import "server-only";

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  discountSettlements,
  patients,
  recalls,
  saleShares,
  sales,
  users,
  visits,
} from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";

/** `users` joined a SECOND time as the approver — a visit references two people. */
const approver = alias(users, "approver");
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

/** The full patient row for their detail page. */
export async function getPatient(clinicId: string, patientId: string) {
  const [row] = await db
    .select()
    .from(patients)
    .where(
      byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)),
    )
    .limit(1);
  return row ?? null;
}

/** A patient's recent appointments, newest first, with the doctor resolved. */
export async function listPatientAppointments(clinicId: string, patientId: string, limit = 20) {
  return db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      status: appointments.status,
      doctorName: users.fullName,
      doctorUsername: users.username,
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.patientId, patientId),
      ),
    )
    .orderBy(desc(appointments.scheduledAt))
    .limit(limit);
}

/**
 * A patient's clinical timeline: APPROVED notes, plus the viewer's OWN drafts.
 *
 * A draft is unreviewed AI output and never counts as the record until a clinician
 * signs it off (ADR-007), so it must not read as clinical fact to a manager or to
 * another doctor. Its AUTHOR is the exception: a scribe session that ends before
 * approval leaves a draft row, and this timeline is the only place its text is
 * legible — filtering it from the author too would make what they dictated
 * unreachable. `approver` is joined separately so an adopted draft (D-18) can show
 * who signed it as well as who dictated it.
 */
export async function listPatientVisits(
  clinicId: string,
  patientId: string,
  viewerId: string | null,
  limit = 30,
) {
  return db
    .select({
      id: visits.id,
      visitDate: visits.visitDate,
      status: visits.status,
      note: visits.note,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      doctorId: visits.doctorId,
      approvedByName: approver.fullName,
      approvedByPrefix: approver.prefix,
      approvedById: visits.approvedBy,
    })
    .from(visits)
    .leftJoin(users, eq(visits.doctorId, users.id))
    .leftJoin(approver, eq(visits.approvedBy, approver.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.patientId, patientId),
        viewerId
          ? or(eq(visits.status, "approved"), eq(visits.doctorId, viewerId))
          : eq(visits.status, "approved"),
      ),
    )
    .orderBy(desc(visits.visitDate))
    .limit(limit);
}

/**
 * APPROVED visits, for the prescription reprint list.
 *
 * Approved ONLY — no viewer-own-drafts exception here, unlike the clinical timeline.
 * A prescription is a thing a patient acts on, so an unsigned draft must never appear
 * in a list someone might print from. The CALLER projects just the drug lines out of
 * the note, so no other clinical data reaches a prescriptions-only viewer.
 */
export async function listPatientPrescriptionVisits(
  clinicId: string,
  patientId: string,
  limit = 50,
) {
  return db
    .select({
      id: visits.id,
      visitDate: visits.visitDate,
      note: visits.note,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
    })
    .from(visits)
    .leftJoin(users, eq(visits.doctorId, users.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.patientId, patientId), eq(visits.status, "approved")),
      ),
    )
    .orderBy(desc(visits.visitDate))
    .limit(limit);
}
