import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments } from "@/core/db/schema";

export type UpcomingAppointment = { id: string; scheduledAt: Date };

/**
 * The patient's next still-live appointment — CORE, clinic-scoped.
 *
 * Shared by patient self-cancellation and the AI assistant, which need the same fact
 * for different reasons: cancellation needs the row to act on, and the assistant needs
 * to know whether one EXISTS at all.
 *
 * That second use is why this is worth a function rather than an inline query.
 * "Make the appointment for Monday" is genuinely ambiguous — book or move? — and the
 * answer depends entirely on whether the patient already has one. Telling the model
 * that fact resolves the ambiguity with data instead of leaving it to guess, which is
 * the same principle as the closed procedure list: the model chooses between options
 * the database defines.
 *
 * `scheduled` and `confirmed` only. A completed, cancelled or no-show visit is not
 * the patient's to move or cancel.
 */
export async function getNextUpcomingAppointment(
  clinicId: string,
  patientId: string,
  now: Date = new Date(),
): Promise<UpcomingAppointment | null> {
  const [row] = await db
    .select({ id: appointments.id, scheduledAt: appointments.scheduledAt })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        and(
          eq(appointments.patientId, patientId),
          gt(appointments.scheduledAt, now),
          inArray(appointments.status, ["scheduled", "confirmed"]),
        ),
      ),
    )
    .orderBy(asc(appointments.scheduledAt))
    .limit(1);
  return row ?? null;
}
