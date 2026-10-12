import "server-only";

import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patientPayments, sales, users } from "@/core/db/schema";
import { paymentKindId } from "@/core/db/vocabulary-seed";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import { procedureTotals, type ProcedureTotals } from "@/core/appointments/procedures";
import { recordSaleForAppointment, voidSaleForAppointment } from "@/core/sales/ledger";
import { report, reportEvent } from "@/core/observability";

/**
 * Sales reconciliation — CORE, the backstop for the derived ledgers (ADR-016).
 *
 * WHY THIS EXISTS: `sales` / `sale_shares` / `discount_settlements` are DERIVED from
 * the appointment. They are now written atomically, so they can never be *internally*
 * half-applied — but the write is still best-effort on the paths where blocking the
 * user would be worse than a delay (taking a payment, most importantly). When one of
 * those fails, the report tells us it happened; this tells us it is *still* wrong, and
 * fixes it.
 *
 * That is the whole argument for keeping those paths best-effort: derived state is
 * RECOMPUTABLE. Unlike a payment — which is a fact about the world and must never be
 * lost — a sale row can be rebuilt from the appointment it came from at any time. So
 * the safe design is: never block the user, always detect, always repair.
 *
 * Drift is detected in SQL against the SAME expression the app bills with
 * (`appointmentNetSql`), so this can't develop its own opinion of what a visit costs.
 */

/**
 * Realised revenue for a visit = what was collected, capped at the bill — whatever
 * the visit's status (revenue follows the money since 2026-10-13).
 *
 * Takes the pre-aggregated procedure totals because this sweep scans every completed
 * appointment in a clinic, for every clinic, nightly — and it names the expression
 * twice in the WHERE below, which with the correlated form meant six reads of
 * `appointment_procedures` per appointment examined.
 */
function expectedNetSql(totals: ProcedureTotals) {
  // From the PAYMENT LEDGER itself — the same rows the sale's money days are built
  // from (`money-days.ts`) — not the `amount_collected` cache, so the check and the
  // ledger it checks can never disagree about how much came in.
  const received = sql`coalesce((select sum(case when p.kind_id = ${paymentKindId("refund")} then -p.amount else p.amount end) from ${patientPayments} p where p.appointment_id = ${appointments.id} and p.clinic_id = ${appointments.clinicId} and p.deleted_at is null and p.kind_id in (${paymentKindId("payment")}, ${paymentKindId("advance_applied")}, ${paymentKindId("refund")})), 0)`;
  return sql<number>`greatest(least(${received}, ${appointmentNetSql(totals)}), 0)`;
}

export type ReconcileResult = {
  /** Visits whose sale rows were missing or didn't add up → re-derived. */
  repaired: number;
  /** Sale rows for visits that were trashed → removed. */
  voided: number;
  /** Rows we tried to fix but couldn't (already reported individually). */
  failed: number;
};

/**
 * Re-derives any drifted sale for ONE clinic. Idempotent and safe to run at any time:
 * every fix goes through the normal `recordSaleForAppointment` /
 * `voidSaleForAppointment` path, so the repair uses exactly the same code as the
 * original write — it can never invent a number the app wouldn't have produced.
 */
export async function reconcileClinicSales(clinicId: string): Promise<ReconcileResult> {
  const out: ReconcileResult = { repaired: 0, voided: 0, failed: 0 };
  const pt = procedureTotals(clinicId);

  // ── Drifted or missing: a visit whose sale rows (one per day money moved) don't add
  // up to its expected realised revenue. Compared as a TOTAL per visit, since the
  // rows are per day.
  const bookedSql = sql<number>`coalesce((select sum(s.net_amount) from ${sales} s where s.appointment_id = ${appointments.id} and s.clinic_id = ${appointments.clinicId}), 0)`;
  const drifted = await db
    .select({ id: appointments.id })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(pt, eq(pt.appointmentId, appointments.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        sql`${bookedSql} <> ${expectedNetSql(pt)}`,
      ),
    );

  for (const a of drifted) {
    try {
      await recordSaleForAppointment(clinicId, a.id);
      out.repaired++;
    } catch (e) {
      out.failed++;
      report(e, { op: "sales.reconcile.repair", clinicId, ids: { appointmentId: a.id } });
    }
  }

  // ── Stale: revenue still on the books for a visit that has been trashed. An
  // OVER-statement, so it matters as much as a missing one.
  const stale = await db
    .selectDistinct({ id: sales.appointmentId })
    .from(sales)
    .innerJoin(appointments, eq(appointments.id, sales.appointmentId))
    .where(byClinic(sales.clinicId, clinicId, isNotNull(appointments.deletedAt)));

  for (const a of stale) {
    try {
      await voidSaleForAppointment(clinicId, a.id);
      out.voided++;
    } catch (e) {
      out.failed++;
      report(e, { op: "sales.reconcile.void", clinicId, ids: { appointmentId: a.id } });
    }
  }

  return out;
}

/**
 * Reconciles every live clinic. Run nightly by cron. Reports a summary always (so a
 * silent night is visible as "ran, found nothing" rather than "didn't run"), and
 * escalates to a WARNING when it actually had to fix something — steady-state drift
 * of zero is the expectation, so a non-zero count means a write path is failing and
 * the reports from that path are worth going to look at.
 */
export async function reconcileAllClinics(): Promise<ReconcileResult & { clinics: number }> {
  const rows = await unscoped("cron: reconcile sales (all clinics)", () =>
    db.select({ id: clinics.id }).from(clinics).where(notDeleted(clinics.deletedAt)),
  );

  const total: ReconcileResult & { clinics: number } = {
    clinics: rows.length,
    repaired: 0,
    voided: 0,
    failed: 0,
  };
  for (const c of rows) {
    const r = await reconcileClinicSales(c.id);
    total.repaired += r.repaired;
    total.voided += r.voided;
    total.failed += r.failed;
  }

  const drifted = total.repaired + total.voided + total.failed;
  reportEvent(
    drifted === 0
      ? "sales reconciliation: no drift"
      : `sales reconciliation repaired ${total.repaired}, voided ${total.voided}, failed ${total.failed}`,
    {
      op: "sales.reconcile",
      severity: drifted === 0 ? "info" : "warn",
      extra: total,
    },
  );
  return total;
}
