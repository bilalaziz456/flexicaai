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
  } else if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    explicitYear = true;
  } else if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    // DD/MM or DD/MM/YYYY (day-first, common locally)
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    date = { y, m: Number(m[2]), d: Number(m[1]) };
    explicitYear = Boolean(m[3]);
  } else if ((m = t.match(/\b(\d{1,2})\s+([a-z]{3,9})\b/)) && MONTHS[m[2]] !== undefined) {
    date = { y: now.getFullYear(), m: MONTHS[m[2]] + 1, d: Number(m[1]) };
  } else if ((m = t.match(/\b([a-z]{3,9})\s+(\d{1,2})\b/)) && MONTHS[m[1]] !== undefined) {
    date = { y: now.getFullYear(), m: MONTHS[m[1]] + 1, d: Number(m[2]) };
  }

  // Basic sanity: reject impossible day/month.
  if (date && (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31)) {
    date = null;
  }

  return { date, time, explicitYear };
}
