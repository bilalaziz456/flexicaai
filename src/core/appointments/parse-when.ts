/**
 * Parse a date and/or time out of a free-text WhatsApp reply — CORE, pure. Used
 * by the reschedule flow so a patient can text e.g. "reschedule 12 Jul 3:00pm".
 * Returns whichever of {date, time} it could find; the caller fills a missing
 * time from the existing appointment and validates the result.
 *
 * Deliberately a small heuristic (not an NLP model): common Pakistani/GCC
 * formats — "12 Jul 3pm", "Jul 12 3:30pm", "12/07 15:00", "2025-07-12 3pm",
 * "tomorrow 4pm", "today 9am".
 */
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// JS getDay() values (0 = Sunday).
const DAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
// Longest-first, \b-bounded so "mon" never matches inside "month"/"money".
const DAY_RE =
  /\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)\b/;

export type ParsedWhen = {
  date: { y: number; m: number; d: number } | null; // m is 1-12
  time: { h: number; min: number } | null;
  /** True when the year was explicitly given (ISO or DD/MM/YYYY). */
  explicitYear: boolean;
};

export function parseWhen(text: string, now: Date = new Date()): ParsedWhen {
  const t = text.toLowerCase();

  // ---- time ----
  let time: ParsedWhen["time"] = null;
  let m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    time = { h, min: m[2] ? Number(m[2]) : 0 };
  } else if ((m = t.match(/\b(\d{1,2}):(\d{2})\b/))) {
    time = { h: Number(m[1]), min: Number(m[2]) };
  }

  // ---- date ----
  let date: ParsedWhen["date"] = null;
  let explicitYear = false;

  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    date = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  } else if (/\btoday\b/.test(t)) {
    date = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  } else if ((m = t.match(DAY_RE)) && DAYS[m[2]] !== undefined) {
    // Weekday name (optionally "next"/"this") → the next upcoming occurrence of
    // that weekday, never today. We resolve "next"/"this"/bare the same way (the
    // soonest future occurrence); the confirmation shows the exact date.
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    let delta = (DAYS[m[2]] - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    const d = new Date(today);
    d.setDate(d.getDate() + delta);
    date = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  } else if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    explicitYear = true;
  } else if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    // DD/MM or DD/MM/YYYY (day-first, common locally)
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    date = { y, m: Number(m[2]), d: Number(m[1]) };
    explicitYear = Boolean(m[3]);
  } else if ((m = t.match(/\b(\d{1,2})\s+([a-z]{3,9})(?:,?\s+(20\d{2}))?\b/)) && MONTHS[m[2]] !== undefined) {
    // "12 Jul", "12 Jul 2027". The year is OPTIONAL and bounded to 20xx on purpose:
    // an unbounded \d{4} would read "12 jul 1500" — someone writing 24-hour time
    // without a colon — as the year 1500, and `explicitYear` would then suppress the
    // next-year correction that normally rescues such a message.
    date = { y: m[3] ? Number(m[3]) : now.getFullYear(), m: MONTHS[m[2]] + 1, d: Number(m[1]) };
    explicitYear = Boolean(m[3]);
  } else if ((m = t.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/)) && MONTHS[m[1]] !== undefined) {
    // "Jul 12", "Jul 12 2027", "Jul 12, 2027".
    date = { y: m[3] ? Number(m[3]) : now.getFullYear(), m: MONTHS[m[1]] + 1, d: Number(m[2]) };
    explicitYear = Boolean(m[3]);
  }

  // Basic sanity: reject impossible day/month.
  if (date && (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31)) {
    date = null;
  }

  return { date, time, explicitYear };
}

/**
 * The inverse of `parseWhen` — a date+time written the way a patient can send it
 * straight back, and the way this parser reads exactly.
 *
 * WHY IT EXISTS. When something other than the parser works out what a patient meant
 * (the AI fallback in `docs/whatsapp-ai-plan.md`), it must not act on that reading.
 * It replies with the request restated in this format and asks the patient to send it
 * back — so the appointment is always produced by `parseWhen`, never by a guess. A
 * misreading then costs one confusing message instead of a wrongly-moved visit.
 *
 * THE INVARIANT: `parseWhen(formatWhen(d), now)` returns exactly `d`. Without it you
 * can send a patient a format your own parser rejects, which is a loop they cannot
 * escape. `scripts/test-parse-when-roundtrip.ts` is the contract, not this comment.
 *
 * THE YEAR IS OMITTED WHEN IT IS THE CURRENT ONE, and that is not cosmetic. "5 Sep
 * 4:00pm" is what a person writes; a bare month-and-day is read as the current year,
 * so it round-trips exactly while it stays in this year. A date in another year MUST
 * carry it — a December booking for January would otherwise come back eleven months
 * early, and `explicitYear` would be false so nothing would correct it.
 *
 * Formats a FUTURE instant, which is all a booking or reschedule ever is. A past date
 * in the current year still round-trips through `parseWhen`; it is the caller's
 * past-date check that would then reject it, which is the correct place for that.
 */
export function formatWhen(when: Date, now: Date = new Date()): string {
  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const day = when.getDate();
  const month = MONTH_NAMES[when.getMonth()];
  const year = when.getFullYear() === now.getFullYear() ? "" : ` ${when.getFullYear()}`;

  // 12-hour with explicit minutes. Midnight and noon are the cases to check against
  // `parseWhen`: it computes `h % 12` and adds 12 for pm, so 00:00 must be "12:00am"
  // and 12:00 must be "12:00pm".
  const h24 = when.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const meridiem = h24 < 12 ? "am" : "pm";
  const minutes = String(when.getMinutes()).padStart(2, "0");

  return `${day} ${month}${year} ${h12}:${minutes}${meridiem}`;
}
