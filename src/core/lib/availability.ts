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

/** "09:30" → "9:30 AM", for reading a working window back to a patient. */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

/** ALL of the doctor's working windows for a JS weekday (0=Sun..6=Sat). */
export function windowsForWeekday(
  availability: DayAvailability[],
  weekday: number,
): DayAvailability[] {
  return availability.filter((a) => a.weekday === weekday);
}

/** The doctor's FIRST window for a weekday, if any (convenience). */
export function availabilityForWeekday(
  availability: DayAvailability[],
  weekday: number,
): DayAvailability | undefined {
  return availability.find((a) => a.weekday === weekday);
}

/**
 * Is the doctor available at this instant? An EMPTY schedule means no restriction
 * (bookable any time) — availability is opt-in per doctor. Otherwise the time
 * must fall within ANY of the weekday's windows (a day can have several, e.g.
 * 09:00–12:00 and 16:00–19:00).
 */
export function isDoctorAvailableAt(
  availability: DayAvailability[],
  when: Date,
): boolean {
  if (!availability || availability.length === 0) return true;
  const t = when.getHours() * 60 + when.getMinutes();
  return windowsForWeekday(availability, when.getDay()).some((w) => {
    const s = timeToMinutes(w.start);
    const e = timeToMinutes(w.end);
    return s !== null && e !== null && t >= s && t < e;
  });
}

/**
 * Human-readable summary, e.g. "Mon 09:00–12:00, 16:00–19:00; Tue 10:00–14:00"
 * or "Any time". Days are separated by "; " since each day may list several
 * windows separated by ", ".
 */
export function describeAvailability(availability: DayAvailability[]): string {
  if (!availability || availability.length === 0) return "Any time";
  return WEEKDAYS.filter(
    (d) => windowsForWeekday(availability, d.value).length > 0,
  )
    .map((d) => {
      const windows = windowsForWeekday(availability, d.value)
        .map((w) => `${w.start}–${w.end}`)
        .join(", ");
      return `${d.short} ${windows}`;
    })
    .join("; ");
}

/** Appointment statuses that consume a slot toward the daily limit. */
export const ACTIVE_APPT_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
] as const;

/** Local-midnight day bounds [start, nextDay) for counting a doctor's day. */
export function dayBounds(when: Date): { start: Date; end: Date } {
  const start = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
