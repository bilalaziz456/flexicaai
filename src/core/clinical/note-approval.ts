import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { appointments, patients, users, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";

/**
 * A note written for ANOTHER doctor's patient waits for that doctor (owner,
 * 2026-11-14). Every note has a treating doctor — whose patient it is — besides its
 * author (`doctor_id`) and its signer (`approved_by`). When the two differ and the
 * treating doctor's `notes_need_approval` is on (the clinic admin's per-doctor
 * setting, on by default), the note is stored `pending_approval`; the treating doctor
 * approves it (possibly after editing) or sends it back with a reason (`returned`),
 * and its author fixes it and sends it again, or discards it.
 *
 * Nothing that follows from a note — its chart change, its prescription, its recall —
 * happens before it is approved: a prescription the treating doctor has not seen must
 * not reach the patient. A waiting note's chart change rides in `pending_chart`.
 *
 * Pure data here; who may call what is decided by the actions.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The doctor a note is for: the appointment's, the one chosen, or the author. */
export async function resolveTreatingDoctor(
  clinicId: string,
  input: { patientId: string; authorId: string; appointmentId?: string | null; chosenDoctorId?: string | null },
): Promise<{ treatingDoctorId: string; appointmentId: string | null } | { error: string }> {
  // Both ids come from a form; a malformed one is refused here, not by Postgres.
  if (input.appointmentId && !UUID.test(input.appointmentId)) return { error: "Appointment not found for this patient." };
  if (input.chosenDoctorId && !UUID.test(input.chosenDoctorId)) return { error: "Doctor not found." };
  if (input.appointmentId) {
    const [appt] = await db
      .select({ doctorId: appointments.doctorId, patientId: appointments.patientId })
      .from(appointments)
      .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), eq(appointments.id, input.appointmentId)))
      .limit(1);
    if (!appt || appt.patientId !== input.patientId) return { error: "Appointment not found for this patient." };
    // An appointment with no doctor is the author's to write for.
    return { treatingDoctorId: appt.doctorId ?? input.authorId, appointmentId: input.appointmentId };
  }
  if (input.chosenDoctorId && input.chosenDoctorId !== input.authorId) {
    const [doc] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          eq(users.id, input.chosenDoctorId),
          eq(users.role, "doctor"),
        ),
      )
      .limit(1);
    if (!doc) return { error: "Doctor not found." };
    return { treatingDoctorId: doc.id, appointmentId: null };
  }
  return { treatingDoctorId: input.authorId, appointmentId: null };
}

/**
 * Does a note by `authorId` for `treatingDoctorId`'s patient wait for them? Only when
 * they differ, the doctor wants it, and the doctor can still sign in — a note waiting
 * for someone who will never approve it would be lost in the queue.
 */
export async function noteNeedsTreatingApproval(
  clinicId: string,
  treatingDoctorId: string | null,
  authorId: string,
): Promise<boolean> {
  if (!treatingDoctorId || treatingDoctorId === authorId) return false;
  const [doc] = await db
    .select({ needs: users.notesNeedApproval, active: users.isActive })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, treatingDoctorId)))
    .limit(1);
  return Boolean(doc && doc.active && doc.needs);
}

/** The clinic admin's per-doctor switch. */
export async function setDoctorNotesApproval(clinicId: string, doctorId: string, needsApproval: boolean): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ notesNeedApproval: needsApproval, updatedAt: new Date() })
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, doctorId), eq(users.role, "doctor")))
    .returning({ id: users.id });
  return rows.length > 0;
}

const author = alias(users, "note_author");

/** Notes waiting for THIS doctor, oldest first (the one waiting longest is first). */
export async function listNotesAwaitingDoctor(clinicId: string, doctorId: string) {
  return db
    .select({
      id: visits.id,
      createdAt: visits.createdAt,
      patientId: visits.patientId,
      patientName: patients.fullName,
      authorName: author.fullName,
      authorPrefix: author.prefix,
      authorUsername: author.username,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .leftJoin(author, eq(visits.doctorId, author.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.status, "pending_approval"),
        eq(visits.treatingDoctorId, doctorId),
      ),
    )
    .orderBy(asc(visits.createdAt));
}

/** Notes THIS author was sent back, with the reason. */
export async function listNotesReturnedToAuthor(clinicId: string, authorId: string) {
  const treating = alias(users, "note_treating");
  return db
    .select({
      id: visits.id,
      createdAt: visits.createdAt,
      patientId: visits.patientId,
      patientName: patients.fullName,
      reviewNote: visits.reviewNote,
      doctorName: treating.fullName,
      doctorPrefix: treating.prefix,
      doctorUsername: treating.username,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .leftJoin(treating, eq(visits.treatingDoctorId, treating.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.status, "returned"),
        eq(visits.doctorId, authorId),
      ),
    )
    .orderBy(asc(visits.createdAt));
}

/**
 * A waiting note for its treating doctor, or a returned one for its author — the only
 * two people who may open either. Everything the review screen needs.
 */
export async function loadNoteForReview(clinicId: string, visitId: string, viewerId: string) {
  const writer = alias(users, "review_author");
  const treating = alias(users, "review_treating");
  const [row] = await db
    .select({
      id: visits.id,
      status: visits.status,
      note: visits.note,
      pendingChart: visits.pendingChart,
      reviewNote: visits.reviewNote,
      transcript: visits.transcript,
      hasAudio: visits.audioKey,
      authorId: visits.doctorId,
      treatingDoctorId: visits.treatingDoctorId,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      module: visits.module,
      authorName: writer.fullName,
      authorPrefix: writer.prefix,
      authorUsername: writer.username,
      treatingName: treating.fullName,
      treatingPrefix: treating.prefix,
      treatingUsername: treating.username,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .leftJoin(writer, eq(visits.doctorId, writer.id))
    .leftJoin(treating, eq(visits.treatingDoctorId, treating.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        inArray(visits.status, ["pending_approval", "returned"]),
      ),
    )
    .limit(1);
  if (!row) return null;
  const mayOpen =
    (row.status === "pending_approval" && row.treatingDoctorId === viewerId) ||
    (row.status === "returned" && row.authorId === viewerId);
  return mayOpen ? row : null;
}

/** The treating doctor signs a waiting note (with their edits). */
export async function approveWaitingNoteRow(
  clinicId: string,
  visitId: string,
  doctorId: string,
  note: Record<string, unknown>,
) {
  const [row] = await db
    .update(visits)
    .set({
      note,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: doctorId,
      pendingChart: null,
      reviewNote: null,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "pending_approval"),
        eq(visits.treatingDoctorId, doctorId),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, module: visits.module, authorId: visits.doctorId });
  return row ?? null;
}

/** The treating doctor sends a waiting note back to its author, saying why. */
export async function returnWaitingNoteRow(clinicId: string, visitId: string, doctorId: string, reason: string) {
  const [row] = await db
    .update(visits)
    .set({ status: "returned", reviewNote: reason, updatedAt: new Date() })
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "pending_approval"),
        eq(visits.treatingDoctorId, doctorId),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, authorId: visits.doctorId });
  return row ?? null;
}

/**
 * The author sends a returned note again, corrected. It waits again — or, when the
 * doctor has since switched approval off, is signed now (`approved`, by the author).
 */
export async function resubmitReturnedNoteRow(
  clinicId: string,
  visitId: string,
  authorId: string,
  input: { note: Record<string, unknown>; pendingChart: unknown; approveNow: boolean },
) {
  const now = new Date();
  const [row] = await db
    .update(visits)
    .set(
      input.approveNow
        ? { note: input.note, status: "approved", approvedAt: now, approvedBy: authorId, pendingChart: null, reviewNote: null, updatedAt: now }
        : { note: input.note, status: "pending_approval", pendingChart: input.pendingChart ?? null, reviewNote: null, updatedAt: now },
    )
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        eq(visits.id, visitId),
        eq(visits.status, "returned"),
        eq(visits.doctorId, authorId),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId, module: visits.module, treatingDoctorId: visits.treatingDoctorId });
  return row ?? null;
}

/** The author bins a returned note (soft delete — it goes to Trash). */
export async function discardReturnedNoteRow(clinicId: string, visitId: string, authorId: string): Promise<boolean> {
  const rows = await db
    .update(visits)
    .set(softDeleteValues(authorId, newDeleteGroup()))
    .where(
      and(
        byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt), eq(visits.id, visitId)),
        eq(visits.status, "returned"),
        eq(visits.doctorId, authorId),
      ),
    )
    .returning({ id: visits.id });
  return rows.length > 0;
}
