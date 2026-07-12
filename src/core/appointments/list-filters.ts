import "server-only";

import { dateFromStr, localDateStr } from "./availability";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Selectable appointment statuses ("" = all). */
export type StatusFilter =
  | ""
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

const STATUSES: StatusFilter[] = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
];

/**
 * Parses the appointment-list URL filters (`from`/`to`/`q`) with sensible
 * defaults: the date range falls back to TODAY (both bounds), a reversed range
 * is tolerated (swapped), and `q` is a trimmed text query. Returns the local
 * day bounds as a half-open interval `[start, endExclusive)` for the query.
 */
export function parseListFilters(sp: {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
}): {
  fromStr: string;
  toStr: string;
  today: string;
  q: string;
  status: StatusFilter;
  start: Date;
  endExclusive: Date;
} {
  const today = localDateStr(new Date());
  let fromStr = sp.from && YMD.test(sp.from) ? sp.from : today;
  let toStr = sp.to && YMD.test(sp.to) ? sp.to : today;
  if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];
  const q = (sp.q ?? "").trim();
  const status: StatusFilter = STATUSES.includes(sp.status as StatusFilter)
    ? (sp.status as StatusFilter)
    : "";
  const start = dateFromStr(fromStr);
  const endExclusive = dateFromStr(toStr);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { fromStr, toStr, today, q, status, start, endExclusive };
}
