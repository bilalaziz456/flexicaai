/**
 * The appointment list's period pills ("Today", "7d", … × Upcoming / Past) as
 * windows of days from today. Pure — shared by the filter bar in the browser and by
 * `parseListFilters` on the server, so a pill and the list it produces cannot disagree.
 *
 * WHY THE SERVER RESOLVES THEM TOO (2026-11-06): the period a person picks is
 * remembered until they sign out (core/lib/remembered-filters.ts). Remembered as two
 * dates, "the next 7 days" chosen on Monday would still be Monday's seven days on
 * Thursday; remembered as `period=7d&dir=upcoming`, it is worked out afresh from
 * today on every visit.
 */

export type ApptDir = "upcoming" | "past";

export const APPT_PERIOD_DAYS: Record<string, number> = {
  today: 1,
  "7d": 7,
  "15d": 15,
  "30d": 30,
  quarter: 90,
  half: 180,
  year: 365,
};

export const isApptPeriod = (v: string | undefined): v is string =>
  typeof v === "string" && Object.hasOwn(APPT_PERIOD_DAYS, v);

export const isApptDir = (v: string | undefined): v is ApptDir => v === "upcoming" || v === "past";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** An inclusive N-day window from `today` ("YYYY-MM-DD"), forward (upcoming) or backward (past). */
export function apptWindow(period: string, today: string, dir: ApptDir): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const span = (APPT_PERIOD_DAYS[period] ?? 1) - 1;
  const edge = new Date(y, m - 1, d);
  edge.setDate(edge.getDate() + (dir === "past" ? -span : span));
  return dir === "past" ? { from: ymd(edge), to: today } : { from: today, to: ymd(edge) };
}

/** The pill a from/to pair is, in a direction — or "" when it is a hand-picked range. */
export function apptPeriodOf(from: string, to: string, today: string, dir: ApptDir): string {
  return (
    Object.keys(APPT_PERIOD_DAYS).find((p) => {
      const w = apptWindow(p, today, dir);
      return w.from === from && w.to === to;
    }) ?? ""
  );
}
