import "server-only";

import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import { ACTIVE_APPT_STATUSES, dayBounds } from "@/core/lib/availability";
import { displayStaffName } from "@/core/types/auth";

export type SameDayAppointment = { scheduledAt: Date; doctorName: string | null };

/**
 * The patient's OTHER live appointments on the day of `when` — what the booking form
 * warns about before creating a second one.
 *
 * A WARNING, not a rule: two visits in one day are usually a double submission or
 * two people at the desk booking the same caller, but sometimes deliberate (a
 * consultation in the morning, the procedure it led to in the evening). So this only
 * informs; the action proceeds once the user confirms.
 *
 * Cancelled and no-show visits do not count — rebooking after a cancellation is the
 * normal case, and warning about it would teach people to click through the warning.
 * Day bounds are the server's local day, like every other day boundary here (D-14).
 */
export async function findSameDayAppointments(
  clinicId: string,
  patientId: string,
  when: Date,
  /** Editing: the appointment being moved, which is not its own duplicate. */
  excludeAppointmentId?: string,
): Promise<SameDayAppointment[]> {
  const { start, end } = dayBounds(when);
  const rows = await db
    .select({
      scheduledAt: appointments.scheduledAt,
      doctorPrefix: users.prefix,
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
        and(
          eq(appointments.patientId, patientId),
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
          inArray(appointments.status, [...ACTIVE_APPT_STATUSES]),
          excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
        ),
      ),
    )
    .orderBy(asc(appointments.scheduledAt));
  return rows.map((r) => ({
    scheduledAt: r.scheduledAt,
    doctorName:
      r.doctorName || r.doctorUsername
        ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "")
        : null,
  }));
}

/** "10:00 with Dr. Faisal Karim, 16:30" — the existing visits, as a WhatsApp reply
 *  quotes them. One wording for booking and reschedule, so the two never drift. */
export function describeSameDay(list: SameDayAppointment[]): string {
  return list
    .map(
      (a) =>
        `${a.scheduledAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}${a.doctorName ? ` with ${a.doctorName}` : ""}`,
    )
    .join(", ");
}
