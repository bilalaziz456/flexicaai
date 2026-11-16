import "server-only";

import { and, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import { clinics } from "@/core/db/schema";

/**
 * `isClinicUsable` (core/clinics/status.ts) as a SQL condition on `clinics`, for the
 * jobs that act on every clinic at once — the reminder and recall crons — so a clinic
 * whose trial ended, or that is paused, is left out of the query rather than skipped
 * row by row. Bound to the TS rule by `scripts/test-clinic-trial.ts`.
 */
export function clinicUsableSql(now: Date = new Date()): SQL {
  return or(
    eq(clinics.status, "active"),
    and(eq(clinics.status, "trial"), or(isNull(clinics.trialEndsAt), gt(clinics.trialEndsAt, now))),
  )!;
}
