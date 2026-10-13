/**
 * "Kept as credit" (`moveExtraToCredit`): extra money on a visit moved to the
 * patient's credit, written as a refund OFF the visit and an advance ON the patient,
 * both with the system method `advance`. No tender moves, so every figure about cash
 * or refunds leaves the pair out — counted, it would show the same amount collected
 * AND refunded, or a refund the patient never received. PURE, so the TS readers and
 * the SQL below state one rule.
 */
import { sql, type SQL } from "drizzle-orm";
import { patientPayments } from "@/core/db/schema";
import { paymentKindId, paymentMethodId } from "@/core/db/vocabulary-seed";

export function isCreditTransfer(p: { kind: string; method: string | null }): boolean {
  return p.method === "advance" && (p.kind === "refund" || p.kind === "advance");
}

/** SQL twin of `!isCreditTransfer(row)` over `patient_payments`. */
export function notCreditTransferSql(): SQL<boolean> {
  return sql<boolean>`not (${patientPayments.method} is not distinct from ${paymentMethodId("advance")} and ${patientPayments.kind} in (${paymentKindId("refund")}, ${paymentKindId("advance")}))`;
}
