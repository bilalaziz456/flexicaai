import "server-only";

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
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

/** Next FCFS number in a session = max existing + 1 (stable across cancels). */
async function nextQueueNumber(clinicId: string, session: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${appointments.queueNumber}), 0)` })
    .from(appointments)
    .where(
      and(eq(appointments.clinicId, clinicId), eq(appointments.queueSession, session)),
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

/** Statuses that count as "still to be seen" in the live queue. */
const WAITING_STATUSES = new Set(["scheduled", "confirmed"]);

export type QueueItem = {
  appointmentId: string;
  number: number | null;
  patientName: string;
  status: string;
  scheduledAt: Date;
};

export type QueueSession = {
  key: string;
  doctorId: string;
  doctorName: string;
  /** "9:00 AM – 12:00 PM" for the window, or "Any time" for a flexible session. */
  windowLabel: string;
  windowStart: string | null; // "HH:MM", for sorting sessions by time
  nowServing: number | null; // lowest waiting token = who's up next
  waiting: number;
  done: number;
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

/** Window "w{idx}" label from a doctor's availability for a date, else "Any time". */
function windowLabelFor(
  sessionKey: string,
  availability: DayAvailability[],
  when: Date,
): { label: string; start: string | null } {
  const suffix = sessionKey.split(":").pop() ?? "day";
  const m = /^w(\d+)$/.exec(suffix);
  if (!m) return { label: "Any time", start: null };
  const windows = windowsForWeekday(availability, when.getDay());
  const w = windows[Number(m[1])];
  if (!w) return { label: "Any time", start: null };
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
      doctorId: appointments.doctorId,
      doctorName: users.fullName,
      doctorUsername: users.username,
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
        doctorName: r.doctorName ?? r.doctorUsername ?? "Doctor",
        windowLabel: label,
        windowStart: wStart,
        nowServing: null,
        waiting: 0,
        done: 0,
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
    });
    s.total += 1;
    if (WAITING_STATUSES.has(r.status)) {
      s.waiting += 1;
      if (s.nowServing === null || r.number < s.nowServing) s.nowServing = r.number;
    } else {
      s.done += 1;
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
