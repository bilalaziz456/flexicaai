import "server-only";

import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, doctorLeaves, patients, users } from "@/core/db/schema";
import {
  ACTIVE_APPT_STATUSES,
  formatTime12,
  windowKind,
  windowsForWeekday,
} from "@/core/lib/availability";
import { appointmentHasProceduresSql } from "./procedures";
import { listClinicDoctors, type ClinicDoctor } from "./doctors";
import { SERVER_TZ } from "@/core/lib/server-tz";
import { localDateStr } from "./availability";
import {
  buildAppointmentConds,
  type AppointmentFilterInput,
} from "./list-query";
import { appointmentSourceId, appointmentStatusId } from "@/core/db/vocabulary-seed";

/** A doctor visiting on a given day. */
export type DutyDoctor = {
  id: string;
  name: string;
  /** "9:00 AM – 12:00 PM" per CONSULTATION window. Empty when `flexible`. */
  windows: string[];
  /** Separate slots kept for longer treatments; empty when the doctor has none. */
  procedureWindows: string[];
  /** Hours aren't enforced for this doctor — show the name, no timing. */
  flexible: boolean;
  onLeave: boolean;
};

/** One cell of the month grid. */
export type CalendarDay = {
  /** Local "YYYY-MM-DD". */
  date: string;
  /** Appointments matching the active filters (cancelled/no-show excluded
   *  unless the user explicitly filtered for a status). */
  total: number;
  /** The same three-way split the Type filter uses; these sum to `total`. */
  consultation: number;
  procedure: number;
  both: number;
  /** Patient self-bookings still awaiting staff confirmation. */
  pendingWhatsapp: number;
  doctors: DutyDoctor[];
};

/** Local-midnight bounds of the month containing `d`, as [start, endExclusive). */
export function monthBounds(d: Date): { start: Date; endExclusive: Date } {
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1),
    endExclusive: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

/** Every local date in [start, endExclusive) as "YYYY-MM-DD". */
function eachDate(start: Date, endExclusive: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start);
  while (cur < endExclusive) {
    out.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * The month grid's data — one row per calendar day in [start, endExclusive).
 *
 * Deliberately THREE queries for the whole month, never one per cell: a grouped
 * appointment aggregate, the leaves overlapping the range, and the clinic's
 * doctors. Who is on duty is then derived in memory from each doctor's weekly
 * availability, so a 31-day × N-doctor grid costs the same as a single day.
 *
 * Honours the same filters as the list (`buildAppointmentConds`), so the grid
 * and the table below it can never disagree about which appointments count.
 */
export async function getCalendarDays(
  clinicId: string,
  start: Date,
  endExclusive: Date,
  filters: Omit<AppointmentFilterInput, "start" | "endExclusive" | "session">,
  doctorsIn?: ClinicDoctor[],
): Promise<CalendarDay[]> {
  const conds = buildAppointmentConds({ ...filters, start, endExclusive });
  // Without an explicit status filter, a cancelled or no-show visit shouldn't
  // make a day look busy — the cell answers "how much work is booked".
  if (!filters.status) {
    conds.push(inArray(appointments.status, [...ACTIVE_APPT_STATUSES]));
  }

  // Bucket by the SERVER's local day, not the database session's. `scheduled_at`
  // is timestamptz, so a bare date_trunc would group by whatever timezone the
  // connection happens to use — putting a late-evening appointment on the wrong
  // cell while dayBounds()/localDateStr() (used everywhere else) put it on the
  // right one. `cast(… as text)` because Postgres can't infer a bare parameter's
  // type in AT TIME ZONE; SERVER_TZ is an IANA name from Intl, never user input.
  const dayExpr = sql<string>`to_char(date_trunc('day', ${appointments.scheduledAt} at time zone cast(${SERVER_TZ} as text)), 'YYYY-MM-DD')`;
  const hasProc = appointmentHasProceduresSql();

  const [rows, leaves, doctors] = await Promise.all([
    db
      .select({
        day: dayExpr,
        total: sql<number>`count(*)::int`,
        // Same derivation as the Type filter, so the three always sum to total.
        consultation: sql<number>`count(*) filter (where not ${hasProc})::int`,
        procedure: sql<number>`count(*) filter (where ${hasProc} and ${appointments.chargeConsultation} = false)::int`,
        both: sql<number>`count(*) filter (where ${hasProc} and ${appointments.chargeConsultation} = true)::int`,
        // A patient self-booking staff haven't acted on: setAppointmentStatus
        // sends the confirmation exactly when such a row moves to 'confirmed'.
        pending: sql<number>`count(*) filter (where ${appointments.source} = ${appointmentSourceId("whatsapp")} and ${appointments.status} = ${appointmentStatusId("scheduled")})::int`,
      })
      .from(appointments)
      .innerJoin(patients, sql`${appointments.patientId} = ${patients.id}`)
      .leftJoin(users, sql`${appointments.doctorId} = ${users.id}`)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(...conds),
        ),
      )
      // By ordinal, so the bucket expression (and its bind parameter) is emitted once.
      .groupBy(sql`1`),
    db
      .select({
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
          and(
            lte(doctorLeaves.startDate, localDateStr(new Date(endExclusive.getTime() - 1))),
            gte(doctorLeaves.endDate, localDateStr(start)),
          ),
        ),
      ),
    doctorsIn ? Promise.resolve(doctorsIn) : listClinicDoctors(clinicId),
  ]);

  const counts = new Map(rows.map((r) => [r.day, r]));
  // Scoped to one doctor, the card is THEIR calendar — listing colleagues'
  // visiting hours next to counts that exclude them would just misread.
  const active = doctors.filter(
    (d) => d.isActive && (!filters.doctorId || d.id === filters.doctorId),
  );

  return eachDate(start, endExclusive).map((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const duty: DutyDoctor[] = [];
    for (const d of active) {
      const windows = windowsForWeekday(d.availability, weekday);
      // A flexible doctor visits every day but keeps no fixed hours; a doctor
      // with no schedule at all is likewise unrestricted (isDoctorAvailableAt).
      const unscheduled = d.flexibleHours || d.availability.length === 0;
      if (!unscheduled && windows.length === 0) continue;
      const label = (w: (typeof windows)[number]) =>
        `${formatTime12(w.start)} – ${formatTime12(w.end)}`;
      duty.push({
        id: d.id,
        name: d.name,
        windows: unscheduled
          ? []
          : windows.filter((w) => windowKind(w) === "consultation").map(label),
        procedureWindows: unscheduled
          ? []
          : windows.filter((w) => windowKind(w) === "procedure").map(label),
        flexible: unscheduled,
        onLeave: leaves.some(
          (l) => l.doctorId === d.id && l.startDate <= date && l.endDate >= date,
        ),
      });
    }

    const hit = counts.get(date);
    return {
      date,
      total: hit?.total ?? 0,
      consultation: hit?.consultation ?? 0,
      procedure: hit?.procedure ?? 0,
      both: hit?.both ?? 0,
      pendingWhatsapp: hit?.pending ?? 0,
      doctors: duty,
    };
  });
}
