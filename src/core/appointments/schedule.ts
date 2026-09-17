import "server-only";

import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, doctorLeaves } from "@/core/db/schema";
import {
  ACTIVE_APPT_STATUSES,
  windowKind,
  windowsForWeekday,
  type DayAvailability,
} from "@/core/lib/availability";
import { SERVER_TZ } from "@/core/lib/server-tz";
import { listClinicDoctors, type ClinicDoctor } from "./doctors";
import { localDateStr } from "./availability";

/**
 * The doctor schedule grid — CORE per ADR-014. One row per doctor, one cell per day:
 * who is working when, who is away, and how much is booked against each of them.
 *
 * Same shape of derivation as `getCalendarDays` (which answers the opposite question,
 * one row per DAY for the appointments calendar): THREE queries for the whole week —
 * the doctors with their weekly schedule, the leaves overlapping the range, and one
 * grouped appointment count — with the per-cell answer derived in memory. A grid of
 * 7 days × N doctors therefore costs the same as a single day.
 *
 * Leave beats hours: a doctor with Monday windows who is on leave that Monday is not
 * working, and the cell says so. That is the same precedence `checkDoctorSlot` applies
 * when a booking is attempted, so the grid cannot promise a slot the booking would
 * then refuse.
 */

export type ScheduleWindow = {
  /** "9:00 AM – 1:00 PM", ready to print. */
  label: string;
  kind: "consultation" | "procedure";
};

export type ScheduleCell = {
  /** Local "YYYY-MM-DD". */
  date: string;
  /** The doctor's working windows that weekday. Empty when away or not working. */
  windows: ScheduleWindow[];
  /** Hours are not enforced for this doctor, so there is no window to print. */
  flexible: boolean;
  onLeave: boolean;
  /** The leave entry covering this day, so the cell can offer to remove it. */
  leaveId: string | null;
  leaveReason: string | null;
  /** Active appointments booked with this doctor that day. */
  booked: number;
};

export type ScheduleRow = {
  doctorId: string;
  name: string;
  /** Initials for the avatar, e.g. "SM". */
  initials: string;
  flexible: boolean;
  /** 0 = unlimited. */
  dailyLimit: number;
  /** Availability as saved, for the "no hours set" case and the editor link. */
  availability: DayAvailability[];
  cells: ScheduleCell[];
};

export type DoctorSchedule = {
  /** The days the grid covers, local "YYYY-MM-DD", in order. */
  dates: string[];
  rows: ScheduleRow[];
};

/** Every local date in `[start, start + days)` as "YYYY-MM-DD". */
export function eachDay(start: Date, days: number): string[] {
  const out: string[] = [];
  const cur = new Date(start);
  for (let i = 0; i < days; i++) {
    out.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Monday of the week containing `d` — the grid always starts on a Monday. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): 0 = Sunday, so Sunday belongs to the week that began six days earlier.
  const back = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - back);
  return out;
}

/**
 * "09:00" → "9am", "09:30" → "9:30am". A grid column is about 100px wide, and the
 * full "9:00 AM – 12:00 PM" wrapped onto two lines in every cell; dropping the empty
 * minutes and the space before the meridiem fits it on one without losing anything.
 */
function compactTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const meridiem = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${meridiem}` : `${h12}:${String(m).padStart(2, "0")}${meridiem}`;
}

function initialsOf(name: string): string {
  const parts = name
    // "Dr. Sana Malik" → the title is not an initial anyone recognises.
    .replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return letters.join("").toUpperCase() || name.slice(0, 2).toUpperCase();
}

export async function getDoctorSchedule(
  clinicId: string,
  start: Date,
  days: number,
  opts: { doctorId?: string } = {},
): Promise<DoctorSchedule> {
  const dates = eachDay(start, days);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + days);

  // Bucket by the SERVER's local day, not the database session's — `scheduled_at` is
  // timestamptz, so a bare date_trunc would file a late-evening visit under the wrong
  // day while `localDateStr` (used everywhere else) files it under the right one.
  const dayExpr = sql<string>`to_char(date_trunc('day', ${appointments.scheduledAt} at time zone cast(${SERVER_TZ} as text)), 'YYYY-MM-DD')`;

  const [doctors, leaves, counts] = await Promise.all([
    listClinicDoctors(clinicId, { doctorId: opts.doctorId }),
    db
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
          // Overlap, not containment: leave that began last week and runs into this
          // one still covers these days.
          and(lte(doctorLeaves.startDate, to), gte(doctorLeaves.endDate, from)),
        ),
      ),
    db
      .select({
        doctorId: appointments.doctorId,
        day: dayExpr,
        total: sql<number>`count(*)::int`,
      })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(
            gte(appointments.scheduledAt, start),
            sql`${appointments.scheduledAt} < ${endExclusive}`,
            // "How much work is booked" — a cancelled or no-show visit is not work.
            inArray(appointments.status, [...ACTIVE_APPT_STATUSES]),
          ),
        ),
      )
      // By ordinal for the day, so the bucket expression is emitted once.
      .groupBy(appointments.doctorId, sql`2`),
  ]);

  const booked = new Map(counts.map((c) => [`${c.doctorId}:${c.day}`, c.total]));

  const rows = doctors
    .filter((d: ClinicDoctor) => d.isActive)
    .map((d) => ({
      doctorId: d.id,
      name: d.name,
      initials: initialsOf(d.name),
      flexible: d.flexibleHours,
      dailyLimit: d.dailyLimit,
      availability: d.availability,
      cells: dates.map((date) => {
        const leave = leaves.find(
          (l) => l.doctorId === d.id && l.startDate <= date && l.endDate >= date,
        );
        const weekday = new Date(`${date}T00:00:00`).getDay();
        const windows = windowsForWeekday(d.availability, weekday).map((w) => ({
          label: `${compactTime(w.start)} – ${compactTime(w.end)}`,
          kind: windowKind(w),
        }));
        return {
          date,
          // Leave wins over hours — see the note at the top.
          windows: leave ? [] : windows,
          flexible: d.flexibleHours,
          onLeave: Boolean(leave),
          leaveId: leave?.id ?? null,
          leaveReason: leave?.reason ?? null,
          booked: booked.get(`${d.id}:${date}`) ?? 0,
        };
      }),
    }));

  return { dates, rows };
}
