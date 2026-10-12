import "server-only";

import { and, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { appointments } from "@/core/db/schema";

/**
 * Which visits can OWE money (Receivables, the dashboard's Outstanding) — ONE rule,
 * shared, so the two never disagree (owner's call, 2026-10-13).
 *
 * A visit whose appointment time has PASSED and which was not cancelled or a no-show.
 * It used to be "status = completed", which meant a visit nobody pressed Complete on
 * never showed as owed — confusing for a front desk that uses the status only to run
 * the queue. A visit next week is not owed yet, whatever its status; a cancelled or
 * no-show visit owes nothing (money held there is a refund due, not a debt).
 */
export function owedVisitSql(): SQL {
  return and(
    lte(appointments.scheduledAt, sql`now()`),
    notInArray(appointments.status, ["cancelled", "no_show"]),
  )!;
}
