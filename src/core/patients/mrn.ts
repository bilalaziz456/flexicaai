import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { patients } from "@/core/db/schema";
import { SERVER_TZ } from "@/core/lib/server-tz";

/**
 * Patient MRN (Medical Record Number) — CORE, specialty-agnostic. A per-clinic,
 * human-friendly patient number allocated sequentially at registration by locking
 * the clinic row and bumping `clinics.next_mrn` (the same collision-free scheme as
 * invoice numbering — see core/billing/invoice.ts). It is shown with the clinic's
 * `mrn_prefix` and is how staff look a patient up on documents / at the front desk.
 */

/**
 * The printable MRN label — `<prefix><YYYYMMDD of registration><7-digit counter>`,
 * e.g. "KL-202607270000042". The date is the patient's registration date (local
 * time, matching the app's timezone convention); the counter is the per-clinic
 * running number, zero-padded to 7. Returns null when the patient has no number.
 */
export function formatMrn(
  prefix: string | null | undefined,
  mrn: number | null | undefined,
  registeredAt: Date | null | undefined,
): string | null {
  if (mrn == null) return null;
  const d = registeredAt ?? new Date();
  const yyyymmdd =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix ?? ""}${yyyymmdd}${String(mrn).padStart(7, "0")}`;
}

/**
 * The digits in a search term, so "MRN-42", "42" and "#42" all resolve to "42".
 * Empty when the term has no digits (then MRN matching is skipped).
 */
export function mrnDigits(q: string): string {
  return q.replace(/\D/g, "");
}

/**
 * SQL predicate: does this patient's RENDERED MRN contain `digits`? Matches what
 * `formatMrn` prints — registration date + padded counter — so "42", "0000042"
 * and a pasted "KL-202607270000042" all resolve to the same patient.
 *
 * The date half must be formatted in the SERVER's zone, not the connection's.
 * `created_at` is timestamptz and a bare `to_char` uses the session TimeZone, so
 * on a box whose Postgres session isn't the app's zone every full-MRN paste
 * missed by a day and found nothing. Use this rather than hand-rolling the
 * concatenation, so every search agrees with the label on the printout.
 */
export function mrnMatchesSql(digits: string): SQL {
  return sql`(to_char(${patients.createdAt} at time zone cast(${SERVER_TZ} as text), 'YYYYMMDD') || lpad(${patients.mrn}::text, 7, '0')) ilike ${`%${digits}%`}`;
}
