import "server-only";

import { and, eq, isNull } from "drizzle-orm";
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

/**
 * Snapshots (upserts) the sale for a COMPLETED appointment on a **collected** basis
 * (Finance Phase 2): realised revenue = what the patient has actually PAID, not the
 * billed amount. Gross/discount are scaled by `collected ÷ bill`, so a half-paid
 * visit books half the revenue; the per-doctor shares scale the same way (in the
 * share ledger). Re-run on completion, edit, approval, restore AND every payment.
 * Best-effort — a ledger hiccup must never block whatever triggered it.
 */
export async function recordSaleForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        status: appointments.status,
        doctorId: appointments.doctorId,
        scheduledAt: appointments.scheduledAt,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        chargeConsultation: appointments.chargeConsultation,
        amountCollected: appointments.amountCollected,
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
    if (!row) return;
    // Only a completed visit has realisable revenue; anything else → no sale.
    if (row.status !== "completed") {
      await voidSaleForAppointment(clinicId, appointmentId);
      return;
    }

    // Billed amounts (a pending/rejected discount doesn't count until approved),
    // then scale to the fraction the patient has actually paid.
    const billed = computeSaleAmounts(
      row.chargeConsultation ? row.fee : 0,
      Number(row.proceduresGross),
      Number(row.proceduresNet),
      row.discountType === "percent" ? "percent" : "amount",
      effectiveDiscountValue(row.discountStatus, row.discountValue),
    );
    const collected = Math.max(0, Math.min(row.amountCollected, billed.net));
    // Nothing collected yet → no realised sale. It appears once the patient pays
    // (a full refund back to 0 removes it again). Keeps the report's counts/averages
    // about PAYING visits; the money owed lives in receivables, not Sales.
    if (collected <= 0) {
      await voidSaleForAppointment(clinicId, appointmentId);
      // The discount-bearing is ACCRUAL — recognised at completion, independent of
      // collection (docs/discount-bearing-plan.md §3). So a completed but unpaid (or
      // 100%-discount) visit still records the settlement even though there's no sale.
      await recordDiscountSettlementForAppointment(clinicId, appointmentId);
      return;
    }
    const fraction = billed.net > 0 ? collected / billed.net : 0;
    const net = collected;
    const gross = Math.round(billed.gross * fraction);
    const discount = Math.max(0, gross - net);
    const doctorName = row.doctorName ?? row.doctorUsername ?? null;

    await db
      .insert(sales)
      .values({
        clinicId,
        appointmentId,
        doctorId: row.doctorId ?? null,
        doctorName,
        grossAmount: gross,
        discountAmount: discount,
        netAmount: net,
        occurredAt: row.scheduledAt,
      })
      .onConflictDoUpdate({
        target: sales.appointmentId,
        set: {
          doctorId: row.doctorId ?? null,
          doctorName,
          grossAmount: gross,
          discountAmount: discount,
          netAmount: net,
          occurredAt: row.scheduledAt,
        },
      });
  } catch {
    // best-effort
  }
  // The per-doctor earnings (collected-basis) + the discount-settlement ledger
  // (accrual) are snapshotted in lockstep with the sale; any per-line waives re-sync
  // to the now-current earned shares.
  await recordSaleSharesForAppointment(clinicId, appointmentId);
  await recordDiscountSettlementForAppointment(clinicId, appointmentId);
  await syncLineWaives(clinicId, appointmentId);
}

/** Removes an appointment's sale (when it leaves "completed"). Best-effort. */
export async function voidSaleForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    await db
      .delete(sales)
      .where(byClinic(sales.clinicId, clinicId, eq(sales.appointmentId, appointmentId)));
  } catch {
    // best-effort
  }
  await voidSaleSharesForAppointment(clinicId, appointmentId);
  await voidDiscountSettlementForAppointment(clinicId, appointmentId);
  // Per-line waives sync to 0 when there's nothing to waive (un-completed / unpaid /
  // soft-deleted), so a waive never lingers as a phantom balance deduction.
  await syncLineWaives(clinicId, appointmentId);
}

/**
 * Records sales for a clinic's existing COMPLETED appointments that don't have
 * one yet — run when the super admin enables the `sales` feature, so the report
 * shows history immediately. Idempotent (skips appointments that already have a
 * sale). Best-effort.
 */
export async function backfillClinicSales(clinicId: string): Promise<void> {
  try {
    const rows = await db
      .select({
        id: appointments.id,
        doctorId: appointments.doctorId,
        scheduledAt: appointments.scheduledAt,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        chargeConsultation: appointments.chargeConsultation,
        amountCollected: appointments.amountCollected,
        fee: users.consultationFee,
        doctorName: users.fullName,
        doctorUsername: users.username,
        proceduresGross: appointmentProceduresGrossSql(),
        proceduresNet: appointmentProceduresNetSql(),
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .leftJoin(sales, eq(sales.appointmentId, appointments.id))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(eq(appointments.status, "completed"), isNull(sales.id)),
        ),
      );
    if (rows.length === 0) return;

    const values = rows.map((r) => {
      const billed = computeSaleAmounts(
        r.chargeConsultation ? r.fee : 0,
        Number(r.proceduresGross),
        Number(r.proceduresNet),
        r.discountType === "percent" ? "percent" : "amount",
        effectiveDiscountValue(r.discountStatus, r.discountValue),
      );
      // Collected basis (Finance Phase 2): realise only what's been paid.
      const collected = Math.max(0, Math.min(r.amountCollected, billed.net));
      const fraction = billed.net > 0 ? collected / billed.net : 0;
      const net = collected;
      const gross = Math.round(billed.gross * fraction);
      return {
        clinicId,
        appointmentId: r.id,
        doctorId: r.doctorId ?? null,
        doctorName: r.doctorName ?? r.doctorUsername ?? null,
        grossAmount: gross,
        discountAmount: Math.max(0, gross - net),
        netAmount: net,
        occurredAt: r.scheduledAt,
      };
    });
    await db.insert(sales).values(values).onConflictDoNothing({
      target: sales.appointmentId,
    });
    // Snapshot each backfilled appointment's per-doctor shares + discount settlement
    // too (idempotent — recording replaces any existing rows for the appointment).
    for (const r of rows) {
      await recordSaleSharesForAppointment(clinicId, r.id);
      await recordDiscountSettlementForAppointment(clinicId, r.id);
    }
  } catch {
    // best-effort
  }
}
