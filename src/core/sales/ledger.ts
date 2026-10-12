import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, sales, users } from "@/core/db/schema";
import { computeSaleAmounts, effectiveDiscountValue } from "@/core/appointments/fee";
import {
  appointmentProceduresGrossSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import {
  recordSaleSharesForAppointment,
  voidSaleSharesForAppointment,
} from "@/core/sales/share-ledger";
import {
  recordDiscountSettlementForAppointment,
  voidDiscountSettlementForAppointment,
} from "@/core/sales/settlement-ledger";
import { syncLineWaives } from "@/core/sales/appointment-lines";
import { getMoneyDays } from "@/core/sales/money-days";
import { report } from "@/core/observability";
import type { Executor, Tx } from "@/core/db/tx";

/**
 * Derives an appointment's sale rows on a **collected, cash** basis: revenue = what
 * the patient has actually PAID, counted on the DAY it was paid (one row per such
 * day — see `money-days.ts`), whatever the visit's status. Gross/discount scale by
 * `collected ÷ bill`, so a half-paid visit books half the revenue; the per-doctor
 * shares follow the same days. Re-run on every payment, refund, edit, approval,
 * status change and restore.
 *
 * ATOMIC (ADR-016). The sale, the per-doctor shares, the discount settlement and the
 * per-line waives are ONE derived set computed from the same appointment, so they are
 * written in ONE transaction: previously they were four sequential writes on four
 * connections, and a crash between them left the set internally inconsistent —
 * revenue booked with nobody credited for it — permanently, because nothing
 * recomputed it.
 *
 * Pass `tx` to JOIN a caller's unit of work (the status change in
 * `applyAppointmentStatus`), in which case failures PROPAGATE and roll the caller
 * back. Without one it opens its own transaction and stays best-effort: it reports
 * and returns, because the state is DERIVED — `reconcileClinicSales` re-derives it
 * from the appointment, so a failure here is a delay, not a loss. That is why money-in
 * (`core/billing/payments.ts`) does not join: a bug in share arithmetic must never
 * block a receptionist from taking payment.
 */
export async function recordSaleForAppointment(
  clinicId: string,
  appointmentId: string,
  tx?: Tx,
): Promise<void> {
  if (tx) return recordSaleInner(clinicId, appointmentId, tx);
  try {
    await db.transaction((t) => recordSaleInner(clinicId, appointmentId, t));
  } catch (e) {
    // The single best-effort boundary. Nothing was half-written — the transaction
    // rolled back — and reconciliation will re-derive it.
    report(e, {
      op: "sales.recordSaleForAppointment",
      clinicId,
      ids: { appointmentId },
    });
  }
}

async function recordSaleInner(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
): Promise<void> {
  const [row] = await exec
    .select({
      status: appointments.status,
      doctorId: appointments.doctorId,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      chargeConsultation: appointments.chargeConsultation,
      fee: users.consultationFee,
      doctorName: users.fullName,
      doctorUsername: users.username,
      proceduresGross: appointmentProceduresGrossSql(),
      proceduresNet: appointmentProceduresNetSql(),
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  // A trashed (or missing) visit books nothing: clear whatever it had.
  if (!row) {
    await voidSaleInner(clinicId, appointmentId, exec);
    return;
  }

  // Billed amounts (a pending/rejected discount doesn't count until approved).
  const billed = computeSaleAmounts(
    row.chargeConsultation ? row.fee : 0,
    Number(row.proceduresGross),
    Number(row.proceduresNet),
    row.discountType === "percent" ? "percent" : "amount",
    effectiveDiscountValue(row.discountStatus, row.discountValue),
  );

  // REVENUE COUNTS ON THE DAY MONEY IS RECEIVED, whatever the visit's status (owner's
  // call, 2026-10-13 — the status is for the queue; the desk records a payment and
  // expects it everywhere). One sale row per day the visit's collected total moved:
  // a deposit, the balance and a refund each land on their own date. A cancelled or
  // no-show visit keeps its money here until it is refunded (shown as Refund due).
  //
  // Rounding is done on the RUNNING totals and the rows are their differences, so
  // the rows always sum to exactly what the old single row booked.
  const days = await getMoneyDays(clinicId, appointmentId, billed.net, exec);
  await exec
    .delete(sales)
    .where(byClinic(sales.clinicId, clinicId, eq(sales.appointmentId, appointmentId)));
  if (days.length > 0) {
    const doctorName = row.doctorName ?? row.doctorUsername ?? null;
    let prevGross = 0;
    const values = days.map((d) => {
      const cumGross = billed.net > 0 ? Math.round((billed.gross * d.cumulative) / billed.net) : 0;
      const gross = cumGross - prevGross;
      prevGross = cumGross;
      return {
        clinicId,
        appointmentId,
        doctorId: row.doctorId ?? null,
        doctorName,
        grossAmount: gross,
        discountAmount: gross - d.delta,
        netAmount: d.delta,
        occurredAt: d.at,
      };
    });
    await exec.insert(sales).values(values);
  }

  // The per-doctor earnings follow the same money days; the discount settlement is
  // accrual (completion OR money received), and the per-line waives re-sync to the
  // now-current shares. Same transaction, so none can disagree with the sale.
  await recordSaleSharesForAppointment(clinicId, appointmentId, exec, days);
  if (days.length > 0 || row.status === "completed") {
    await recordDiscountSettlementForAppointment(clinicId, appointmentId, exec);
  } else {
    await voidDiscountSettlementForAppointment(clinicId, appointmentId, exec);
  }
  await syncLineWaives(clinicId, appointmentId, exec);
}

/** Removes an appointment's sale rows (the visit was trashed). Best-effort. */
export async function voidSaleForAppointment(
  clinicId: string,
  appointmentId: string,
  tx?: Tx,
): Promise<void> {
  if (tx) return voidSaleInner(clinicId, appointmentId, tx);
  try {
    await db.transaction((t) => voidSaleInner(clinicId, appointmentId, t));
  } catch (e) {
    // A failed void leaves revenue on the books for a visit that is gone — an
    // OVER-statement, so it matters as much as a failed record.
    report(e, { op: "sales.voidSaleForAppointment", clinicId, ids: { appointmentId } });
  }
}

/** The void as one atomic step — see `recordSaleInner`. Throws; caller reports. */
async function voidSaleInner(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
): Promise<void> {
  await exec
    .delete(sales)
    .where(byClinic(sales.clinicId, clinicId, eq(sales.appointmentId, appointmentId)));
  await voidSaleSharesForAppointment(clinicId, appointmentId, exec);
  await voidDiscountSettlementForAppointment(clinicId, appointmentId, exec);
  // Per-line waives sync to 0 when there's nothing to waive (un-completed / unpaid /
  // soft-deleted), so a waive never lingers as a phantom balance deduction.
  await syncLineWaives(clinicId, appointmentId, exec);
}

/**
 * Derives the sales of a clinic's existing visits that have money against them but no
 * sale rows yet — run when the super admin enables the `sales` feature, so the report
 * shows history immediately. Goes through the normal write path per visit (the money
 * days need each visit's payment ledger), so it can never book a figure the app
 * itself wouldn't. Idempotent; best-effort.
 */
export async function backfillClinicSales(clinicId: string): Promise<void> {
  try {
    const rows = await db
      .select({ id: appointments.id })
      .from(appointments)
      .leftJoin(sales, eq(sales.appointmentId, appointments.id))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(or(gt(appointments.amountCollected, 0), eq(appointments.status, "completed")), isNull(sales.id)),
        ),
      );
    for (const r of rows) await recordSaleForAppointment(clinicId, r.id);
  } catch (e) {
    report(e, { op: "sales.backfillClinicSales", clinicId });
  }
}
