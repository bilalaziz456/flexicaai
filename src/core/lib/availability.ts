/**
 * Doctor availability + daily capacity — CORE, specialty-agnostic. Every
 * specialty's doctors keep working hours and a per-day appointment cap, so this
 * lives in core (not a module). Pure and isomorphic (usable from client + server
 * — no "server-only"): the schedule editor and the booking guard share it.
 *
 * Weekdays use the JS convention: 0 = Sunday … 6 = Saturday (Date.getDay()).
 */

/** One working window on a given weekday, e.g. Mon 09:00–17:00. */
export type DayAvailability = { weekday: number; start: string; end: string };

/** Display order (Mon first) with labels. `value` is the JS getDay() number. */
export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

/** "HH:MM" 24-hour. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timeToMinutes(hhmm: string): number | null {
  if (!TIME_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** The doctor's window for a JS weekday (0=Sun..6=Sat), if any. */
export function availabilityForWeekday(
  availability: DayAvailability[],
  weekday: number,
): DayAvailability | undefined {
  return availability.find((a) => a.weekday === weekday);
}

/**
 * Is the doctor available at this instant? An EMPTY schedule means no restriction
 * (bookable any time) — availability is opt-in per doctor. Otherwise the weekday
 * must be configured and the start time within [start, end).
 */
export function isDoctorAvailableAt(
  availability: DayAvailability[],
  when: Date,
): boolean {
  if (!availability || availability.length === 0) return true;
  const slot = availabilityForWeekday(availability, when.getDay());
  if (!slot) return false;
  const t = when.getHours() * 60 + when.getMinutes();
  const s = timeToMinutes(slot.start);
  const e = timeToMinutes(slot.end);
  if (s === null || e === null) return false;
  return t >= s && t < e;
}

/** Human-readable summary, e.g. "Mon 09:00–17:00, Tue 10:00–14:00" or "Any time". */
export function describeAvailability(availability: DayAvailability[]): string {
  if (!availability || availability.length === 0) return "Any time";
  return WEEKDAYS.filter((d) => availability.some((a) => a.weekday === d.value))
    .map((d) => {
      const slot = availabilityForWeekday(availability, d.value)!;
      return `${d.short} ${slot.start}–${slot.end}`;
    })
    .join(", ");
}

/** Appointment statuses that consume a slot toward the daily limit. */
export const ACTIVE_APPT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
] as const;

/** Local-midnight day bounds [start, nextDay) for counting a doctor's day. */
export function dayBounds(when: Date): { start: Date; end: Date } {
  const start = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
