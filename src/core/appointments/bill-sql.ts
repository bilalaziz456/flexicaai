import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { appointments, users } from "@/core/db/schema";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import { discountStatusId, discountTypeId } from "@/core/db/vocabulary-seed";

/**
 * THE appointment bill, in SQL — CORE. The single canonical expression, and the
 * counterpart to `computeBill` in `core/appointments/fee.ts` (ADR-015).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A SQL COPY OF THE MONEY LOGIC EXISTS AT ALL
 * ─────────────────────────────────────────────────────────────────────────
 * The bill has to be computed two ways and both are legitimate:
 *   • per-appointment in TypeScript, where the lines are already loaded — the
 *     invoice, the receipt, the booking form (`computeBill`);
 *   • as a set, inside a query — the appointment list, receivables, the invoice
 *     list, the dashboard KPIs. Doing that per row in JS would be N+1 on every
 *     list screen.
 * So the duplication is a performance requirement, not an accident. What was NOT
 * acceptable is how it was held together: this expression existed as TWO
 * byte-identical copies (`list-query.ts#appointmentNetSql` and
 * `receivables.ts#appointmentBillNetSql`), each documented as "the single source",
 * plus prose in three other files claiming to "mirror" the TS. Nothing enforced any
 * of it.
 *
 * It is now ONE expression, and `scripts/test-bill-parity.ts` is the contract: it
 * builds randomised appointments and asserts this SQL and `computeBill` agree to the
 * rupee. **If you change this expression or `computeBill`, that test is what tells
 * you whether you changed both.** Change one without the other and it goes red.
 *
 * THE FORMULA (identical to `computeBill`, in the same order — order matters):
 *   1. each procedure line: net = gross − its own clamped discount
 *   2. subtotal = (consultation, if charged) + Σ line nets
 *   3. appointment discount applies to that SUBTOTAL, not to the gross
 *   4. net = subtotal − that discount, clamped to [0, subtotal]
 * Applying step 3 to the gross instead is the classic way these drift, and it
 * silently overstates what the patient owes whenever a line discount is present.
 *
 * REQUIRES `users` joined on `appointments.doctorId` — the consultation fee is read
 * live from the doctor, never stored on the appointment, so a fee change flows
 * through to unbilled visits.
 */

/**
 * The discount that ACTUALLY applies, given its approval state. Mirrors
 * `fee.ts#effectiveDiscountValue`: a 'pending' or 'rejected' discount counts as 0
 * until approved, so the bill behaves as if there were none.
 */
function effectiveDiscountSql(): SQL {
  return sql`(case when ${appointments.discountStatus} in (${discountStatusId("pending")}, ${discountStatusId("rejected")}) then 0 else ${appointments.discountValue} end)`;
}

/** Consultation fee when charged, else 0 (a procedure-only visit). */
function consultationSql(): SQL {
  return sql`(case when ${appointments.chargeConsultation} then coalesce(${users.consultationFee}, 0) else 0 end)`;
}

/** Step 2: consultation + Σ line nets — what the appointment discount applies to. */
export function appointmentSubtotalSql(): SQL<number> {
  return sql<number>`(${consultationSql()} + ${appointmentProceduresNetSql()})`;
}

/**
 * The appointment's NET bill — what the patient owes. The canonical expression;
 * every list, report and KPI that needs "the bill" uses THIS, so they can't disagree
 * with each other or with the printed invoice.
 */
/**
 * The discount in RUPEES that the appointment's own discount takes off the subtotal —
 * clamped to `0 ≤ discount ≤ subtotal`, exactly as `fee.ts#computeFee` does.
 *
 * `raw: true` ignores the approval gate and returns what the discount WOULD take off.
 * The discounts report needs that (it shows pending discounts at their would-be value
 * and totals them separately), while the bill needs the gated one. Both come from
 * this single expression rather than a second copy of the clamp — ADR-015.
 */
export function appointmentDiscountSql(opts?: { raw?: boolean }): SQL<number> {
  const subtotal = appointmentSubtotalSql();
  const v = opts?.raw ? sql`${appointments.discountValue}` : effectiveDiscountSql();
  // NUMERIC before the percent multiply — see the note on `appointmentNetSql`.
  return sql<number>`(least(greatest(round(case when ${appointments.discountType} = ${discountTypeId("percent")} then ${subtotal}::numeric * ${v} / 100.0 else ${v}::numeric end), 0), ${subtotal}))::int`;
}

export function appointmentNetSql(): SQL<number> {
  const subtotal = appointmentSubtotalSql();
  const eff = effectiveDiscountSql();
  // NUMERIC, not int4, for the percent multiply. `discount_value` has no upper bound
  // in the schema or in validation, so a percent discount of e.g. 99999 is storable —
  // and `subtotal * 99999` overflows int4 and makes Postgres THROW. TS just clamps,
  // so the two disagreed in the worst way: one returns a number, the other 500s every
  // list that aggregates bills (appointments, receivables, invoices, dashboard KPIs)
  // for that clinic until the row is edited. Promoting to numeric makes the SQL clamp
  // exactly like `computeFee` does. The result is 0 ≤ net ≤ subtotal, so the final
  // ::int can never overflow. Found by scripts/test-bill-parity.ts.
  return sql<number>`(${subtotal} - least(greatest(round(case when ${appointments.discountType} = ${discountTypeId("percent")} then ${subtotal}::numeric * ${eff} / 100.0 else ${eff}::numeric end), 0), ${subtotal}))::int`;
}
