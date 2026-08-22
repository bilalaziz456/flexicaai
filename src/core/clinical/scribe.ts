import "server-only";

import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, patients, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { draftAccessCondition } from "@/core/clinical/drafts";

/**
 * Every query the voice scribe makes — CORE per ADR-014.
 *
 * WHAT STAYS IN THE ACTION, and why this module stops where it does: approving a note
 * resolves the enabled MODULE's contract (`clinicalSchemasFor`, `clinicalRecordFor`)
 * to validate the note's shape and persist the specialty record. Core must never
 * import `/modules` or the registry (ADR-001, §3), so that orchestration belongs at
 * the app layer, which may. The seam is therefore the QUERY, not the operation — the
 * same shape as Trash taking module rows as data.
 *
 * So: this owns the tenant scoping, the soft-delete filters and the author rule; the
 * action owns permissions, module resolution and `revalidatePath`.
 */

/** Patients for the scribe picker — most recently added first. */
export async function listScribePatients(clinicId: string, limit = 20) {
  return db
    .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)))
    .orderBy(desc(patients.createdAt))
    .limit(limit);
}

/** The picker's search. Same shape as `listScribePatients`, so the UI can't tell them apart. */
export async function searchScribePatients(clinicId: string, q: string, limit = 20) {
  const query = q.trim();
  const search = query
    ? or(ilike(patients.fullName, `%${query}%`), ilike(patients.phone, `%${query}%`))
    : undefined;
  return db
    .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), search))
    .orderBy(desc(patients.createdAt))
    .limit(limit);
}

/**
 * The clinic's recent notes: everything APPROVED, plus this user's own unapproved
 * drafts — the same rule the patient timeline follows, so a doctor never sees a
 * colleague's unsigned work anywhere.
 */
export async function listRecentVisits(clinicId: string, userId: string, limit = 10) {
  return db
    .select({
      id: visits.id,
      status: visits.status,
      visitDate: visits.visitDate,
      patientName: patients.fullName,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        or(eq(visits.status, "approved"), eq(visits.doctorId, userId)),
      ),
    )
    .orderBy(desc(visits.visitDate))
    .limit(limit);
}

/** Drafts this user started and never approved. Oldest first — the one left longest
 *  is the one most likely to be forgotten. */
export async function listOwnDrafts(clinicId: string, userId: string, limit = 20) {
  return db
    .select({ id: visits.id, visitDate: visits.visitDate, patientName: patients.fullName })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.status, "draft"), eq(visits.doctorId, userId)),
      ),
    )
    .orderBy(visits.visitDate)
    .limit(limit);
}

/** Which doctor an appointment belongs to — the "only your own patients" check. */
export async function getAppointmentDoctorId(
  clinicId: string,
  appointmentId: string,
): Promise<string | null | undefined> {
  const [row] = await db
    .select({ doctorId: appointments.doctorId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  return row ? row.doctorId : undefined; // undefined = no such appointment here
}

/** True when the patient belongs to THIS clinic — the scribe route's tenant boundary. */
export async function patientBelongsToClinic(
  clinicId: string,
  patientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  return Boolean(row);
}

/** Creates the visit a scribe run fills in (delta D-08): audio stored, note pending. */
export async function createScribeRun(input: {
  clinicId: string;
  patientId: string;
  doctorId: string;
  module: string;
  audioKey: string;
}): Promise<string> {
  const [visit] = await db
    .insert(visits)
    .values({ ...input, status: "transcribing" })
    .returning({ id: visits.id });
  return visit.id;
}

/**
 * A draft to review. The author rule lives in `draftAccessCondition` — one predicate
 * shared with approve and discard, because D-16 was exactly the bug of it living in
 * one of the three and being forgotten in the others.
 *
 * Returns the ROW; the caller computes drug/allergy warnings, since those need the
 * enabled module's formulary and core cannot reach a module.
 */
export async function loadDraftRow(
  clinicId: string,
  userId: string,
  visitId: string,
  canHandover: boolean,
) {
  const [row] = await db
    .select({
      id: visits.id,
      transcript: visits.transcript,
      note: visits.note,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "draft"),
        draftAccessCondition(userId, canHandover),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Marks a draft approved with the clinician's edited note.
 *
 * The note arrives ALREADY VALIDATED — the caller parses it against the module's
 * shape (ADR-007), which core cannot do. This is the only writer of `visits.note`,
 * and it matches `status = 'draft'` only, so an approved note is never rewritten.
 */
export async function approveDraftRow(
  clinicId: string,
  userId: string,
  visitId: string,
  note: Record<string, unknown>,
  canHandover: boolean,
) {
  const [row] = await db
    .update(visits)
    .set({
      note,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: userId,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "draft"),
        draftAccessCondition(userId, canHandover),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, module: visits.module });
  return row ?? null;
}

/**
 * Soft-deletes a draft, so it lands in Trash rather than vanishing.
 *
 * `failed` is included (D-08): a run the AI could not finish still holds a real
 * recording and the doctor must be able to bin it. `transcribing` is deliberately
 * excluded — binning a run mid-flight would leave the job about to write a note onto
 * a soft-deleted visit.
 */
export async function discardDraftRow(
  clinicId: string,
  userId: string,
  visitId: string,
  canHandover: boolean,
): Promise<boolean> {
  const rows = await db
    .update(visits)
    .set(softDeleteValues(userId, newDeleteGroup()))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        inArray(visits.status, ["draft", "failed"]),
        draftAccessCondition(userId, canHandover),
      ),
    )
    .returning({ id: visits.id });
  return rows.length > 0;
}

/** What sending a prescription needs: the visit's state, the patient, the clinic name. */
export async function getVisitForPrescription(clinicId: string, visitId: string) {
  const [row] = await db
    .select({
      clinicId: visits.clinicId,
      status: visits.status,
      patientId: visits.patientId,
      patientName: patients.fullName,
      patientPhone: patients.phone,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.id, visitId)))
    .limit(1);
  return row ?? null;
}
