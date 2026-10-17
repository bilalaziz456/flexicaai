import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { appointments, patients, prescriptions, users, type Prescription } from "@/core/db/schema";
import type { PrescriptionItem } from "@/core/lib/prescription-items";

/**
 * Typed prescriptions — CORE, specialty-agnostic (owner's call, 2026-10-14). The desk
 * enters what the doctor wrote; it is printed on the clinic's letterhead
 * (core/clinics/letterhead.ts). Clinic-scoped and soft-deleted like everything else.
 */

export type PrescriptionInput = {
  patientId: string;
  appointmentId: string | null;
  doctorId: string | null;
  prescribedOn: string; // YYYY-MM-DD
  items: PrescriptionItem[];
  notes: string | null;
};

/** A patient's live prescriptions, newest first. */
export async function listPrescriptions(clinicId: string, patientId: string): Promise<Prescription[]> {
  return db
    .select()
    .from(prescriptions)
    .where(
      byClinic(
        prescriptions.clinicId,
        clinicId,
        notDeleted(prescriptions.deletedAt),
        eq(prescriptions.patientId, patientId),
      ),
    )
    .orderBy(desc(prescriptions.prescribedOn), desc(prescriptions.createdAt));
}

/** One live prescription with what its printout needs, or null when it is not this clinic's. */
export async function getPrescriptionForPrint(clinicId: string, id: string) {
  const [row] = await db
    .select({
      prescription: prescriptions,
      patientName: patients.fullName,
      patientMrn: patients.mrnLabel,
      patientDob: patients.dateOfBirth,
      patientGender: patients.gender,
      doctorPrefix: users.prefix,
    })
    .from(prescriptions)
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .leftJoin(users, eq(users.id, prescriptions.doctorId))
    .where(byClinic(prescriptions.clinicId, clinicId, notDeleted(prescriptions.deletedAt), eq(prescriptions.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * The checks every write needs: the patient, the appointment (it must be THIS patient's)
 * and the doctor (a doctor of this clinic) all belong to the clinic. Returns the doctor's
 * name to snapshot, or an error for the form.
 */
async function checkRefs(
  clinicId: string,
  input: PrescriptionInput,
): Promise<{ doctorName: string | null } | { error: string }> {
  const [p] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, input.patientId)))
    .limit(1);
  if (!p) return { error: "Patient not found." };
  if (input.appointmentId) {
    const [a] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(eq(appointments.id, input.appointmentId), eq(appointments.patientId, input.patientId)),
        ),
      )
      .limit(1);
    if (!a) return { error: "That appointment isn't this patient's." };
  }
  if (!input.doctorId) return { error: "Choose the doctor who prescribed it." };
  const [d] = await db
    .select({ prefix: users.prefix, fullName: users.fullName, username: users.username })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, input.doctorId), inArray(users.role, ["doctor", "clinic_admin"])),
      ),
    )
    .limit(1);
  if (!d) return { error: "Choose a doctor of this clinic." };
  return { doctorName: d.fullName ?? d.username };
}

export async function createPrescription(
  clinicId: string,
  input: PrescriptionInput,
  actor: { id: string; name: string },
): Promise<{ id: string } | { error: string }> {
  const refs = await checkRefs(clinicId, input);
  if ("error" in refs) return refs;
  const [row] = await db
    .insert(prescriptions)
    .values({
      clinicId,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      doctorId: input.doctorId,
      doctorName: refs.doctorName,
      prescribedOn: input.prescribedOn,
      items: input.items,
      notes: input.notes,
      createdBy: actor.id,
      createdByName: actor.name,
    })
    .returning({ id: prescriptions.id });
  return { id: row.id };
}

export async function updatePrescription(
  clinicId: string,
  id: string,
  input: PrescriptionInput,
): Promise<{ ok: true } | { error: string }> {
  const refs = await checkRefs(clinicId, input);
  if ("error" in refs) return refs;
  const res = await db
    .update(prescriptions)
    .set({
      appointmentId: input.appointmentId,
      doctorId: input.doctorId,
      doctorName: refs.doctorName,
      prescribedOn: input.prescribedOn,
      items: input.items,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        prescriptions.clinicId,
        clinicId,
        notDeleted(prescriptions.deletedAt),
        and(eq(prescriptions.id, id), eq(prescriptions.patientId, input.patientId)),
      ),
    )
    .returning({ id: prescriptions.id });
  return res.length > 0 ? { ok: true } : { error: "Prescription not found." };
}

/** Moves a prescription to Trash (restorable). */
export async function softDeletePrescription(clinicId: string, id: string, actorId: string): Promise<boolean> {
  const res = await db
    .update(prescriptions)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(byClinic(prescriptions.clinicId, clinicId, notDeleted(prescriptions.deletedAt), eq(prescriptions.id, id)))
    .returning({ id: prescriptions.id });
  return res.length > 0;
}

/** The patient's appointments to link a prescription to (recent first), for the form. */
export async function listPrescriptionAppointmentOptions(clinicId: string, patientId: string) {
  return db
    .select({ id: appointments.id, scheduledAt: appointments.scheduledAt, doctorId: appointments.doctorId })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.patientId, patientId),
      ),
    )
    .orderBy(desc(appointments.scheduledAt))
    .limit(30);
}
