import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import type { DayAvailability } from "@/core/lib/availability";

/**
 * Appointment writes — CORE per ADR-014.
 *
 * The QUEUE is what shapes this module. An appointment carries a per-doctor,
 * per-window token number, so an edit that moves it to a different doctor or window
 * has to surrender the old token and take a new one — and taking one races other
 * bookings, which `withQueueNumber` handles by retrying on a unique violation. That
 * retry needs to re-run the write, so the write is exposed as its own function rather
 * than buried in a branch.
 */

/** What an edit needs to know before it can decide about the queue token. */
export async function findAppointmentForEdit(clinicId: string, appointmentId: string) {
  const [row] = await db
    .select({
      id: appointments.id,
      queueSession: appointments.queueSession,
      status: appointments.status,
    })
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
  return row ?? null;
}

/**
 * Applies a set of field changes to one appointment, clinic-scoped.
 *
 * Deliberately takes an opaque `values` object: the caller has already validated the
 * form and decided what the queue fields should become, and re-listing thirteen
 * columns here would be a second place for them to drift from the schema.
 */
export async function updateAppointmentFields(
  clinicId: string,
  appointmentId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await db
    .update(appointments)
    .set(values)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    );
}

/**
 * Trashes an appointment. Returns whether a row matched, so the caller can tell
 * "done" from "not this clinic's".
 *
 * The realised-revenue rows derived from it are the CALLER's business to void — that
 * is `core/sales/ledger`, and folding it in here would make a soft delete depend on
 * the sales domain (ADR-016 keeps the derived ledgers behind their own entry points).
 */
export async function softDeleteAppointment(
  clinicId: string,
  appointmentId: string,
  actorId: string,
): Promise<boolean> {
  const [row] = await db
    .update(appointments)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .returning({ id: appointments.id });
  return Boolean(row);
}

/** A doctor's scheduling fields — what the availability check reads. */
export async function getDoctorScheduleFields(
  clinicId: string,
  doctorId: string,
): Promise<{ availability: DayAvailability[]; flexibleHours: boolean; dailyLimit: number } | null> {
  const [row] = await db
    .select({
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      dailyLimit: users.dailyAppointmentLimit,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    availability: (row.availability ?? []) as DayAvailability[],
    flexibleHours: row.flexibleHours,
    dailyLimit: row.dailyLimit,
  };
}

/** Sets a doctor's daily appointment cap. Returns false if the id isn't a doctor here. */
export async function setDoctorDailyLimit(
  clinicId: string,
  doctorId: string,
  limit: number,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ dailyAppointmentLimit: limit, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .returning({ id: users.id });
  return rows.length > 0;
}

/**
 * Books an appointment and returns its id.
 *
 * Called from inside `withQueueNumber`, which may RETRY on a unique violation when two
 * bookings race for the same token — so this must stay a plain insert with no side
 * effects of its own.
 */
export async function insertAppointment(
  values: Record<string, unknown>,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(appointments)
    .values(values as typeof appointments.$inferInsert)
    .returning({ id: appointments.id });
  return row;
}

/** The patient an appointment belongs to — the billing actions' tenant check. */
export async function getAppointmentPatientId(
  clinicId: string,
  appointmentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ patientId: appointments.patientId })
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
  return row?.patientId ?? null;
}

/**
 * An appointment's status. Used after a discount decision to ask whether the sale
 * needs re-snapshotting — no `notDeleted`, because a trashed appointment's sale was
 * already voided and asking about it is harmless.
 */
export async function getAppointmentStatus(
  clinicId: string,
  appointmentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ status: appointments.status })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  return row?.status ?? null;
}
