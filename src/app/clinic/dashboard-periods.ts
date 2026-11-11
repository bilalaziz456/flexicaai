/**
 * The dashboard's periods — one choice drives every figure on the page (owner,
 * 2026-11-11). "This month" is the calendar month so far; the others are rolling.
 * Plain data, no directive, so the server page and the client picker share it (a
 * value imported from a "use client" file reaches a server component as a reference,
 * not the array).
 */
export const DASHBOARD_PERIODS = [
  { value: "today", label: "Today", title: "Today", suffix: "today", phrase: "today", compare: "vs yesterday" },
  { value: "month", label: "This month", title: "From the 1st of this month to today", suffix: "this month", phrase: "this month", compare: "vs the same days last month" },
  { value: "quarter", label: "3 months", title: "The last 3 months", suffix: "3 months", phrase: "in the last 3 months", compare: "vs the 3 months before" },
  { value: "half", label: "6 months", title: "The last 6 months", suffix: "6 months", phrase: "in the last 6 months", compare: "vs the 6 months before" },
  { value: "year", label: "Year", title: "The last 12 months", suffix: "12 months", phrase: "in the last 12 months", compare: "vs the year before" },
] as const;

export type DashboardPeriodValue = (typeof DASHBOARD_PERIODS)[number]["value"];

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodValue = "month";

/** The period named in the URL, or the default for anything else. */
export function dashboardPeriod(raw: string | undefined) {
  return DASHBOARD_PERIODS.find((p) => p.value === raw) ?? DASHBOARD_PERIODS.find((p) => p.value === DEFAULT_DASHBOARD_PERIOD)!;
}
