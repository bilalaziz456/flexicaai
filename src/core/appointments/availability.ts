import "server-only";

import { and, count, eq, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, doctorLeaves, users } from "@/core/db/schema";
import {
  ACTIVE_APPT_STATUSES,
  availabilityForWeekday,
  dayBounds,
  describeAvailability,
  isDoctorAvailableAt,
  type DayAvailability,
} from "@/core/lib/availability";

/** Local "YYYY-MM-DD" for a Date (clinic wall-clock day). */
export function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local midnight Date from a "YYYY-MM-DD" string. */
export function dateFromStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Is the doctor on leave/vacation on the given local date (YYYY-MM-DD)? */
export async function doctorOnLeave(
  clinicId: string,
  doctorId: string,
  dateStr: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: doctorLeaves.id })
    .from(doctorLeaves)
    .where(
      byClinic(
        doctorLeaves.clinicId,
        clinicId,
        and(
          eq(doctorLeaves.doctorId, doctorId),
          lte(doctorLeaves.startDate, dateStr),
          gte(doctorLeaves.endDate, dateStr),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Counts a doctor's slot-consuming appointments on the calendar day of `when`.
 * `excludeAppointmentId` skips one appointment (used when rescheduling within the
 * same day so it doesn't count itself against the cap).
 */
export async function countDoctorDay(
  clinicId: string,
  doctorId: string,
  when: Date,
  excludeAppointmentId?: string,
): Promise<number> {
  const { start, end } = dayBounds(when);
  const [row] = await db
    .select({ value: count() })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        and(
          eq(appointments.doctorId, doctorId),
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
          inArray(appointments.status, [...ACTIVE_APPT_STATUSES]),
          excludeAppointmentId
            ? ne(appointments.id, excludeAppointmentId)
            : undefined,
        ),
      ),
    );
  return row?.value ?? 0;
}

export type SlotCheck =
  | { ok: true; doctorName: string; fee: number }
  | { ok: false; reason: string };

/**
 * The single source of truth for "can this doctor take an appointment at this
 * time" — leave, working hours, and the daily cap. Used by booking AND by the
 * WhatsApp reschedule flow so both enforce identical rules. Clinic-scoped.
 */
export async function checkDoctorSlot(
  clinicId: string,
  doctorId: string,
  when: Date,
  opts?: { excludeAppointmentId?: string },
): Promise<SlotCheck> {
  const [doc] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false, reason: "Doctor not found." };

  const name = doc.fullName ?? doc.username;
  const availability = doc.availability as DayAvailability[];

  if (await doctorOnLeave(clinicId, doc.id, localDateStr(when))) {
    return { ok: false, reason: `${name} is on leave that day.` };
  }

  // Working hours are enforced only for non-flexible doctors. A flexible doctor
  // can be booked at any time (leave + daily cap below still apply).
  if (!doc.flexibleHours) {
    if (availability.length === 0) {
      return {
        ok: false,
        reason: `${name} has no visiting hours set — please contact the clinic.`,
      };
    }
    if (!isDoctorAvailableAt(availability, when)) {
      const slot = availabilityForWeekday(availability, when.getDay());
      return {
        ok: false,
        reason: slot
          ? `${name} works ${slot.start}–${slot.end} that day.`
          : `${name} isn't available then (hours: ${describeAvailability(availability)}).`,
      };
    }
  }

  if (doc.dailyLimit > 0) {
    const booked = await countDoctorDay(
      clinicId,
      doc.id,
      when,
      opts?.excludeAppointmentId,
    );
    if (booked >= doc.dailyLimit) {
      return {
        ok: false,
        reason: `${name} is fully booked that day (${booked}/${doc.dailyLimit}).`,
      };
    }
  }

  return { ok: true, doctorName: name, fee: doc.fee };
}
