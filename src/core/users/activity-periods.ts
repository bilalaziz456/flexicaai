/**
 * The windows the doctor activity card offers, in MONTHS — and the pure date maths
 * that turns one into a from/to pair.
 *
 * NO `server-only` and no imports that carry it, deliberately: the period pills are a
 * client component and the resolver is a server one, so this vocabulary has to be
 * legible from both. `activity-range.ts` is the server half; it is the only thing
 * that knows what a range MEANS to a query. (Conventions §3 — shared logic stays
 * pure so the two sides cannot disagree, same reason `fee.ts` has no DB import.)
 *
 * The ladder is deliberately NOT the reports' `PERIOD_PRESETS` (today / 30d / quarter
 * / 6mo / year / all). A report answers "what happened in this period"; this answers
 * "what has this person been doing lately", and a day or a month of one doctor's work
 * is too few appointments to read anything from — someone who saw eleven patients
 * last month and nine this month has not changed. Three months is the shortest window
 * that carries a signal, and there is no "all time" because a figure averaged over a
 * whole employment stops describing the present.
 */
export const ACTIVITY_MONTHS = [3, 6, 9, 12] as const;

export const ACTIVITY_PRESETS = ACTIVITY_MONTHS.map((m) => ({
  value: `${m}m`,
  label: `${m}mo`,
  title: `Last ${m} months`,
}));

/** Const-array + union rather than an enum, per conventions §1 — the values and the
 *  type stay in one declaration, so a pill the resolver cannot resolve fails to
 *  compile instead of silently falling back to three months. */
export type DoctorActivityPeriod = `${(typeof ACTIVITY_MONTHS)[number]}m` | "custom";

export const DEFAULT_ACTIVITY_PERIOD: DoctorActivityPeriod = "3m";

/** Local-time YYYY-MM-DD, the app's server-local convention. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The inclusive from/to a month preset covers, ending today.
 *
 * CALENDAR months, not 30-day multiples: "3 months" of a person's work means back to
 * the same date in June, which is what anyone checking against a calendar expects.
 */
export function activityPresetDates(period: string | undefined): { from: string; to: string } {
  const months = ACTIVITY_MONTHS.find((m) => `${m}m` === period) ?? 3;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setMonth(start.getMonth() - months);
  // setMonth OVERFLOWS a short month: 31 May minus 3 lands on 3 March, not 28
  // February, so the window would quietly be three months plus a few days. Pulling
  // back to day 0 of the following month is the last day of the intended one.
  if (start.getDate() !== today.getDate()) start.setDate(0);

  return { from: ymd(start), to: ymd(today) };
}
