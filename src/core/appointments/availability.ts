import "server-only";

import { and, asc, count, eq, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, doctorLeaves, users } from "@/core/db/schema";
import {
  ACTIVE_APPT_STATUSES,
  allowedKindsFor,
  dayBounds,
  describeAvailability,
  isDoctorAvailableAt,
  windowsOfKind,
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
        notDeleted(doctorLeaves.deletedAt),
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
        notDeleted(appointments.deletedAt),
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
  | {
      ok: true;
      doctorName: string;
      fee: number;
      // The doctor's schedule at check time, so callers can derive the queue
      // session without re-querying (see core/appointments/queue.ts).
      availability: DayAvailability[];
      flexible: boolean;
      /**
       * Was this time inside the doctor's allowed windows ANYWAY — i.e. would it have
       * passed without `customTime`? Computed regardless of the override, so a caller
       * can tell whether the override was actually needed and avoid storing
       * `custom_time` on a visit that sits in normal hours (which would be a stored
       * lie, and would put it on the wrong queue card).
       */
      withinHours: boolean;
    }
  | { ok: false; reason: string };

/**
 * The single source of truth for "can this doctor take an appointment at this
 * time" — leave, working hours, and the daily cap. Used by booking AND by the
 * WhatsApp reschedule flow so both enforce identical rules. Clinic-scoped.
 *
 * `hasProcedures` widens the acceptable hours to include the doctor's procedure
 * windows; omitted, only consultation windows count. A doctor who has never
 * tagged a window has consultation windows only, so nothing changes for them.
 */
export async function checkDoctorSlot(
  clinicId: string,
  doctorId: string,
  when: Date,
  opts?: { excludeAppointmentId?: string; hasProcedures?: boolean; customTime?: boolean },
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
        notDeleted(users.deletedAt),
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
  //
  // `customTime` is the same escape hatch per APPOINTMENT rather than per doctor:
  // staff arranging a procedure for 6pm when the doctor consults 1–3pm. It relaxes
  // the time-of-day rule ONLY — the leave check above and the daily cap below still
  // run, because agreeing to come in at 6pm is not the same as being available during
  // your holiday or beyond your own cap.
  // A visit with procedures may use either kind of window — the patient is in the
  // chair once, and a procedure may run inside consulting hours or in a slot of its
  // own. A pure consultation is held to consultation windows.
  const kinds = allowedKindsFor(Boolean(opts?.hasProcedures));
  // Evaluated whether or not the override was asked for, so the caller can tell an
  // override that was NEEDED from one that was ticked and turned out to be
  // unnecessary. A flexible doctor is never constrained, so nothing is ever outside.
  const withinHours =
    doc.flexibleHours ||
    (availability.length > 0 && isDoctorAvailableAt(availability, when, kinds));

  if (!doc.flexibleHours && !opts?.customTime) {
    if (availability.length === 0) {
      return {
        ok: false,
        reason: `${name} has no visiting hours set. Please contact the clinic.`,
      };
    }
    if (!withinHours) {
      const windows = windowsOfKind(availability, when.getDay(), kinds);
      const label = opts?.hasProcedures ? "" : "for consultations ";
      return {
        ok: false,
        reason: windows.length
          ? `${name} works ${label}${windows.map((w) => `${w.start}–${w.end}`).join(", ")} that day.`
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

  return {
    ok: true,
    doctorName: name,
    fee: doc.fee,
    availability,
    flexible: doc.flexibleHours,
    withinHours,
  };
}

/**
 * A clinic's leave entries that have not yet ended — CORE per ADR-014, for the
 * doctors/leave panel.
 *
 * `from` is a YYYY-MM-DD day, and the filter is `end_date >= from` rather than
 * `start_date >= from`: leave that STARTED last week and runs through next week is
 * still current, and dropping it would show a doctor as available while they are away.
 */
export async function listUpcomingLeaves(
  clinicId: string,
  from: string,
  opts: { doctorId?: string } = {},
) {
  return db
    .select({
      id: doctorLeaves.id,
      doctorId: doctorLeaves.doctorId,
      startDate: doctorLeaves.startDate,
      endDate: doctorLeaves.endDate,
      reason: doctorLeaves.reason,
    })
    .from(doctorLeaves)
    .where(
      byClinic(
        doctorLeaves.clinicId,
        clinicId,
        notDeleted(doctorLeaves.deletedAt),
        and(
          gte(doctorLeaves.endDate, from),
          // A doctor's own dashboard shows only their leave.
          opts.doctorId ? eq(doctorLeaves.doctorId, opts.doctorId) : undefined,
        ),
      ),
    )
    .orderBy(asc(doctorLeaves.startDate));
}
