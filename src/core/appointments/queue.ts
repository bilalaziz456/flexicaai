import "server-only";

import { and, asc, eq, gte, like, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import {
  dayBounds,
  timeToMinutes,
  windowsForWeekday,
  type DayAvailability,
} from "@/core/lib/availability";
import { localDateStr } from "./availability";

/** 23505 = Postgres unique_violation, possibly nested on `err.cause`. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "23505"
    ) {
      return true;
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return false;
}

/**
 * Queue session key for a doctor appointment: `${doctorId}:${YYYY-MM-DD}:w{idx}`
 * where `idx` is the doctor's visiting-window (for the appointment's weekday)
 * that contains the time — so a doctor's 9–12 and 4–7 windows are separate
 * queues that each number from 1. A flexible/no-window doctor (or a time that
 * doesn't land in any window) uses a single per-day session `:day`.
 */
export function queueSessionKey(
  doctorId: string,
  when: Date,
  availability: DayAvailability[],
  flexible: boolean,
): string {
  const date = localDateStr(when);
  if (flexible || !availability || availability.length === 0) {
    return `${doctorId}:${date}:day`;
  }
  const windows = windowsForWeekday(availability, when.getDay());
  const mins = when.getHours() * 60 + when.getMinutes();
  const idx = windows.findIndex((w) => {
    const s = timeToMinutes(w.start);
    const e = timeToMinutes(w.end);
    return s !== null && e !== null && mins >= s && mins < e;
  });
  return `${doctorId}:${date}:${idx >= 0 ? `w${idx}` : "day"}`;
}

/**
 * Do two session keys belong to the same doctor on the same day?
 *
 * The unit that matters when deciding whether a MOVE needs a new token. Numbers are
 * unique per doctor-day, so shifting between windows within one day keeps the token:
 * it is already unique there, and the patient has been told it. Re-issuing on any
 * session change also made the row count ITSELF in the day's max, so moving an
 * appointment from morning to afternoon bumped its own number.
 *
 * A key is `${doctorId}:${date}:${window}`, so the doctor-day is its first two
 * segments. Exported because both the staff edit action and the WhatsApp reschedule
 * decide this, and two copies of the rule would drift.
 */
export function sameDoctorDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const day = (k: string) => k.split(":").slice(0, 2).join(":");
  return day(a) === day(b);
}

/**
 * Next FCFS number = max existing + 1 across the doctor's WHOLE DAY (stable across
 * cancels).
 *
 * Deliberately per doctor-day, not per session. A session is a display grouping —
 * one card per visiting window — but the TOKEN is what a patient is told and quotes
 * at the desk, so two people seeing the same doctor on the same day must never hold
 * the same number. Numbering per session gave a doctor with a morning and an evening
 * clinic two "#1"s, and a custom-time visit (which falls outside every window, into
 * the `:day` bucket) a third.
 *
 * The session key is `${doctorId}:${date}:${window}`, so the doctor-day is its first
 * two segments and a LIKE prefix matches every session within it. Day-unique numbers
 * are automatically session-unique, so the existing
 * (clinic_id, queue_session, queue_number) index still holds.
 */
async function nextQueueNumber(clinicId: string, session: string): Promise<number> {
  const doctorDay = session.split(":").slice(0, 2).join(":");
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${appointments.queueNumber}), 0)` })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        like(appointments.queueSession, `${doctorDay}:%`),
      ),
    );
  return Number(row?.max ?? 0) + 1;
}

type QueueContext = {
  clinicId: string;
  doctorId: string | null;
  when: Date;
  availability: DayAvailability[];
  flexible: boolean;
};

/**
 * Runs `write` with the queue fields it should persist. For a doctor
 * appointment it assigns the next FCFS number in the (doctor, day, window)
 * session and retries on the (clinic, session, number) unique-index race; for a
 * no-doctor ("Any") appointment it writes NULL queue fields. Use for INSERT
 * (booking) and UPDATE (move to a new session). Keep numbers stable: only call
 * this when the appointment truly needs a NEW session number.
 */
export async function withQueueNumber<T>(
  ctx: QueueContext,
  write: (q: { queueSession: string | null; queueNumber: number | null }) => Promise<T>,
): Promise<T> {
  const { clinicId, doctorId, when, availability, flexible } = ctx;
  if (!doctorId) return write({ queueSession: null, queueNumber: null });

  const session = queueSessionKey(doctorId, when, availability, flexible);
  for (let attempt = 0; ; attempt++) {
    const queueNumber = await nextQueueNumber(clinicId, session);
    try {
      return await write({ queueSession: session, queueNumber });
    } catch (err) {
      // Another booking grabbed the same number — recompute and retry a few times.
      if (attempt < 3 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

/** Not-yet-arrived statuses (booked, patient hasn't checked in). */
const NOT_ARRIVED = new Set(["scheduled", "confirmed"]);

export type QueueItem = {
  appointmentId: string;
  number: number | null;
  patientName: string;
  status: string;
  scheduledAt: Date;
  arrivedAt: Date | null;
};

export type QueueSession = {
  key: string;
  doctorId: string;
  doctorName: string;
  /** "9:00 AM – 12:00 PM" for the window, or "Any time" for a flexible session. */
  windowLabel: string;
  windowStart: string | null; // "HH:MM", for sorting sessions by time
  nowServing: number | null; // lowest in_progress token = who's in the room now
  notArrived: number; // scheduled/confirmed (haven't checked in)
  waiting: number; // arrived (checked in, in the waiting room)
  inRoom: number; // in_progress (with the doctor)
  done: number; // completed
  missed: number; // cancelled/no_show
  total: number;
  items: QueueItem[];
};

const pad = (n: number) => String(n).padStart(2, "0");
/** "09:30" → "9:30 AM". */
function label12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${mer}`;
}

/**
 * Card heading for a session: the window's hours, or a description of why it has none.
 *
 * The `:day` bucket means two different things and they must not read alike. For a
 * doctor with no windows that day it genuinely is "Any time" — they are flexible or
 * unscheduled. For a doctor who DOES have windows it is the overflow bucket a
 * CUSTOM-TIME visit lands in, and calling that "Any time" is false: the visit has a
 * definite time, it is simply outside the hours. It says so instead.
 */
function windowLabelFor(
  sessionKey: string,
  availability: DayAvailability[],
  when: Date,
): { label: string; start: string | null } {
  const suffix = sessionKey.split(":").pop() ?? "day";
  const windows = windowsForWeekday(availability, when.getDay());
  const noWindow = windows.length > 0 ? "Outside visiting hours" : "Any time";
  const m = /^w(\d+)$/.exec(suffix);
  if (!m) return { label: noWindow, start: null };
  const w = windows[Number(m[1])];
  if (!w) return { label: noWindow, start: null };
  return { label: `${label12(w.start)} – ${label12(w.end)}`, start: w.start };
}

/**
 * The live queue for a clinic on a given day, grouped by doctor visiting-window
 * session. `nowServing` is the lowest still-waiting token (the number the doctor
 * is up to); `waiting` counts scheduled/confirmed; `done` counts everything
 * else. Clinic-scoped; optionally narrowed to one doctor (the doctor panel).
 * Only appointments that carry a queue number are included.
 */
export async function getDayQueue(
  clinicId: string,
  day: Date,
  opts?: { doctorId?: string },
): Promise<QueueSession[]> {
  const { start, end } = dayBounds(day);

  const rows = await db
    .select({
      appointmentId: appointments.id,
      number: appointments.queueNumber,
      session: appointments.queueSession,
      status: appointments.status,
      scheduledAt: appointments.scheduledAt,
      arrivedAt: appointments.arrivedAt,
      doctorId: appointments.doctorId,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      availability: users.availability,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(users, eq(appointments.doctorId, users.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        and(
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
          sql`${appointments.queueNumber} is not null`,
          opts?.doctorId ? eq(appointments.doctorId, opts.doctorId) : undefined,
        ),
      ),
    )
    .orderBy(asc(appointments.queueNumber));

  const bySession = new Map<string, QueueSession>();
  for (const r of rows) {
    if (!r.session || r.number === null || !r.doctorId) continue;
    let s = bySession.get(r.session);
    if (!s) {
      const { label, start: wStart } = windowLabelFor(
        r.session,
        (r.availability ?? []) as DayAvailability[],
        r.scheduledAt,
      );
      s = {
        key: r.session,
        doctorId: r.doctorId,
        doctorName: displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "Doctor"),
        windowLabel: label,
        windowStart: wStart,
        nowServing: null,
        notArrived: 0,
        waiting: 0,
        inRoom: 0,
        done: 0,
        missed: 0,
        total: 0,
        items: [],
      };
      bySession.set(r.session, s);
    }
    s.items.push({
      appointmentId: r.appointmentId,
      number: r.number,
      patientName: r.patientName,
      status: r.status,
      scheduledAt: r.scheduledAt,
      arrivedAt: r.arrivedAt,
    });
    s.total += 1;
    // Bucket by live state. "Now serving" is the lowest token actually in the room
    // (in_progress) — so late patients who were skipped don't masquerade as serving.
    if (r.status === "in_progress") {
      s.inRoom += 1;
      if (s.nowServing === null || r.number < s.nowServing) s.nowServing = r.number;
    } else if (r.status === "arrived") {
      s.waiting += 1;
    } else if (NOT_ARRIVED.has(r.status)) {
      s.notArrived += 1;
    } else if (r.status === "completed") {
      s.done += 1;
    } else {
      s.missed += 1; // cancelled / no_show
    }
  }

  // Sort sessions by window start time (flexible "day" sessions last), then name.
  return [...bySession.values()].sort((a, b) => {
    if (a.windowStart && b.windowStart) return a.windowStart.localeCompare(b.windowStart);
    if (a.windowStart) return -1;
    if (b.windowStart) return 1;
    return a.doctorName.localeCompare(b.doctorName);
  });
}
