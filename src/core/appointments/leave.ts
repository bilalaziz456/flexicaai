import "server-only";

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, doctorLeaves, users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";

/**
 * Doctor leave / vacation — CORE per ADR-014.
 *
 * Setting leave is not just a row: it CANCELS the doctor's appointments in the range,
 * because a clinic that records leave and leaves the bookings standing has told the
 * patients nothing and the doctor the wrong thing. That cancellation shares the leave
 * row's transaction, so the two can never disagree.
 *
 * What deliberately stays OUTSIDE the transaction is telling the patients: a WhatsApp
 * provider must not be able to roll back a leave entry, and holding a transaction open
 * across a network call is how a pool gets exhausted (ADR-016). So these functions
 * return the ids they cancelled and the caller notifies afterwards.
 */

/** A YYYY-MM-DD day as a local Date. */
function dayStart(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The exclusive upper bound for an INCLUSIVE end date — leave covers its last day. */
function dayAfter(s: string): Date {
  const d = dayStart(s);
  d.setDate(d.getDate() + 1);
  return d;
}

/** The doctor an id refers to, if they are this clinic's and still live. */
export async function findClinicDoctor(clinicId: string, doctorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
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
  return row?.id ?? null;
}

/** One leave entry — the range a caller is about to edit or remove. */
export async function findLeave(clinicId: string, leaveId: string) {
  const [row] = await db
    .select({
      id: doctorLeaves.id,
      doctorId: doctorLeaves.doctorId,
      startDate: doctorLeaves.startDate,
      endDate: doctorLeaves.endDate,
    })
    .from(doctorLeaves)
    .where(
      byClinic(
        doctorLeaves.clinicId,
        clinicId,
        notDeleted(doctorLeaves.deletedAt),
        eq(doctorLeaves.id, leaveId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Cancels the doctor's still-active appointments across `[start, end]` inclusive. */
async function cancelInRange(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  clinicId: string,
  doctorId: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const rows = await tx
    .update(appointments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        and(
          eq(appointments.doctorId, doctorId),
          // Only bookings that are still going to happen; a completed or already
          // cancelled visit is history and must not be rewritten by a leave entry.
          inArray(appointments.status, ["scheduled", "confirmed"]),
          gte(appointments.scheduledAt, dayStart(startDate)),
          lt(appointments.scheduledAt, dayAfter(endDate)),
        ),
      ),
    )
    .returning({ id: appointments.id });
  return rows.map((r) => r.id);
}

/** Records leave and cancels the clashing appointments. Returns the cancelled ids. */
export async function addDoctorLeave(
  clinicId: string,
  doctorId: string,
  input: { startDate: string; endDate: string; reason: string | null },
): Promise<string[]> {
  let cancelled: string[] = [];
  await db.transaction(async (tx) => {
    await tx.insert(doctorLeaves).values({ clinicId, doctorId, ...input });
    cancelled = await cancelInRange(tx, clinicId, doctorId, input.startDate, input.endDate);
  });
  return cancelled;
}

/** Moves a leave range and cancels whatever the NEW range now clashes with. */
export async function updateDoctorLeave(
  clinicId: string,
  leaveId: string,
  doctorId: string,
  input: { startDate: string; endDate: string; reason: string | null },
): Promise<string[]> {
  let cancelled: string[] = [];
  await db.transaction(async (tx) => {
    await tx
      .update(doctorLeaves)
      .set(input)
      .where(byClinic(doctorLeaves.clinicId, clinicId, eq(doctorLeaves.id, leaveId)));
    cancelled = await cancelInRange(tx, clinicId, doctorId, input.startDate, input.endDate);
  });
  return cancelled;
}

/**
 * Trashes a leave entry.
 *
 * It does NOT un-cancel the appointments the leave cancelled — those patients have
 * already been told the visit is off, and silently reinstating a booking nobody
 * expects is worse than making the clinic rebook it deliberately.
 */
export async function softDeleteLeave(
  clinicId: string,
  leaveId: string,
  actorId: string,
): Promise<void> {
  await db
    .update(doctorLeaves)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        doctorLeaves.clinicId,
        clinicId,
        notDeleted(doctorLeaves.deletedAt),
        eq(doctorLeaves.id, leaveId),
      ),
    );
}
