import "server-only";

import { and, eq, gt, inArray, lte, not, sql, type SQL } from "drizzle-orm";
import { appointments, patientPayments } from "@/core/db/schema";
import { paymentKindId } from "@/core/db/vocabulary-seed";
import type { VisitPaymentStatus } from "@/core/billing/payment-status";

/**
 * `visitPaymentStatus` (payment-status.ts) as a SQL predicate, so a list can FILTER by
 * the badge and still page and total in SQL (ADR-024). Two expressions of one rule are
 * bound by `scripts/test-invoice-payment-filter.ts`, which checks every invoice's TS
 * badge against the filter that selected it (ADR-015's rule for mirrored logic).
 *
 * `bill` is the visit's net bill expression (`appointmentNetSql`), passed in so the
 * caller's join set (procedure totals, users) is the one it reads.
 */
export function refundedSql(): SQL<number> {
  return sql<number>`coalesce((select sum(${patientPayments.amount}) from ${patientPayments} where ${patientPayments.appointmentId} = ${appointments.id} and ${patientPayments.clinicId} = ${appointments.clinicId} and ${patientPayments.kind} = ${paymentKindId("refund")} and ${patientPayments.deletedAt} is null), 0)`;
}

export function paymentStatusSql(status: VisitPaymentStatus, bill: SQL): SQL {
  const coll = appointments.amountCollected;
  const gone = inArray(appointments.status, ["cancelled", "no_show"]);
  const live = not(gone);
  const tookMoney = gt(coll, 0);
  const refunded = sql`${refundedSql()} > 0`;
  switch (status) {
    case "refund_due":
      return and(gone, tookMoney)!;
    case "refunded":
      // Nothing held now, something given back — cancelled or not.
      return and(lte(coll, 0), refunded)!;
    case "not_paid":
      return and(live, lte(coll, 0), not(refunded), sql`${bill} > 0`)!;
    case "paid":
      return and(live, tookMoney, sql`${coll} >= ${bill}`)!;
    case "partially_paid":
      return and(live, tookMoney, sql`${coll} < ${bill}`, eq(appointments.status, "completed"))!;
    case "advance_paid":
      return and(live, tookMoney, sql`${coll} < ${bill}`, not(eq(appointments.status, "completed")))!;
  }
}

/** Still owed on a LIVE visit: max(0, bill − collected). */
export function outstandingSql(bill: SQL): SQL<number> {
  return sql<number>`greatest(${bill} - ${appointments.amountCollected}, 0)`;
}
