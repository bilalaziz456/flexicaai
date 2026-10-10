import "server-only";

import { dateFromStr, localDateStr } from "./availability";
import {
  APPOINTMENT_STATUS_ROWS,
  type AppointmentStatusCode,
} from "@/core/db/vocabulary-seed";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
// A doctor id reaches a uuid column, where a malformed value makes Postgres THROW
// rather than match nothing — so it is shape-checked before it gets near a query.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Selectable appointment statuses ("" = all). */
/** A filter is any appointment status, or "" for all — derived, never restated. */
export type StatusFilter = "" | AppointmentStatusCode;

const STATUSES: readonly StatusFilter[] = APPOINTMENT_STATUS_ROWS.map((r) => r.code);

/** Visit type: what the appointment is FOR ("" = any). Derived from the
 *  consultation charge + whether any procedures are attached. */
export type VisitTypeFilter = "" | "consultation" | "procedure" | "both";
const VISIT_TYPES: VisitTypeFilter[] = ["consultation", "procedure", "both"];

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
  type?: string;
  doctor?: string;
  procedure?: string;
}): {
  fromStr: string;
  toStr: string;
  today: string;
  q: string;
  status: StatusFilter;
  type: VisitTypeFilter;
  /** The Doctor filter ("" = every doctor). A request, not a scope — see
   *  `appointmentDoctorFilter`, which lets a doctor's own scope win over it. */
  doctor: string;
  /** The Procedure filter — a catalog procedure id ("" = any). */
  procedure: string;
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
  const type: VisitTypeFilter = VISIT_TYPES.includes(sp.type as VisitTypeFilter)
    ? (sp.type as VisitTypeFilter)
    : "";
  const doctor = sp.doctor && UUID.test(sp.doctor) ? sp.doctor : "";
  const procedure = sp.procedure && UUID.test(sp.procedure) ? sp.procedure : "";
  const start = dateFromStr(fromStr);
  const endExclusive = dateFromStr(toStr);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { fromStr, toStr, today, q, status, type, doctor, procedure, start, endExclusive };
}
