/**
 * The Clinical notes list's period (owner, 2026-11-14): Today, This month (the calendar
 * month so far), 3 / 6 / 9 months and Year — each ending TODAY, because notes are
 * written for visits that have happened — or a start and end date. Pure, so the
 * filter bar and the server agree on what each pill means.
 */
export const NOTES_PERIODS = [
  { value: "today", label: "Today", title: "Today's appointments" },
  { value: "month", label: "This month", title: "From the 1st of this month to today" },
  { value: "3m", label: "3 months", title: "The last 3 months" },
  { value: "6m", label: "6 months", title: "The last 6 months" },
  { value: "9m", label: "9 months", title: "The last 9 months" },
  { value: "year", label: "Year", title: "The last 12 months" },
] as const;

export type NotesPeriod = (typeof NOTES_PERIODS)[number]["value"];

const MONTHS: Record<string, number> = { "3m": 3, "6m": 6, "9m": 9, year: 12 };

export const isNotesPeriod = (v: string | undefined): v is NotesPeriod =>
  NOTES_PERIODS.some((p) => p.value === v);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v: string | undefined): v is string => typeof v === "string" && YMD.test(v);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The dates a pill covers, inclusive, ending `today` ("YYYY-MM-DD"). */
export function notesWindow(period: NotesPeriod, today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  if (period === "today") return { from: today, to: today };
  if (period === "month") return { from: ymd(new Date(y, m - 1, 1)), to: today };
  // N months back, the day after: "3 months" on 14 Nov is 15 Aug – 14 Nov.
  const start = new Date(y, m - 1 - MONTHS[period], d + 1);
  return { from: ymd(start), to: today };
}

/** Which pill a from/to is, or "" for dates someone picked. */
export function notesPeriodOf(from: string, to: string, today: string): NotesPeriod | "" {
  return NOTES_PERIODS.find((p) => {
    const w = notesWindow(p.value, today);
    return w.from === from && w.to === to;
  })?.value ?? "";
}

/**
 * The window to show: dates when both are valid (swapped if backwards), else the
 * pill, else Today.
 */
export function resolveNotesWindow(
  params: { period?: string; from?: string; to?: string },
  today: string,
): { from: string; to: string; period: NotesPeriod | "" } {
  if (isYmd(params.from) && isYmd(params.to)) {
    const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    return { from, to, period: notesPeriodOf(from, to, today) };
  }
  const period = isNotesPeriod(params.period) ? params.period : "today";
  return { ...notesWindow(period, today), period };
}

/** What the list's Note filter narrows to. */
export const NOTE_FILTERS = [
  { value: "", label: "Any note" },
  { value: "missing", label: "No note yet" },
  { value: "waiting", label: "Waiting for approval" },
  { value: "written", label: "Note written" },
] as const;
export type NoteFilter = (typeof NOTE_FILTERS)[number]["value"];
export const isNoteFilter = (v: string | undefined): v is NoteFilter =>
  NOTE_FILTERS.some((f) => f.value === v);
