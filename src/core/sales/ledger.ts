import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import {
  appointmentProcedures,
  appointments,
  sales,
  users,
} from "@/core/db/schema";
import { computeAppointmentTotal } from "@/core/appointments/fee";

const procTotalSql = sql<number>`coalesce((select sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity}) from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${appointments.id}), 0)`;

/**
 * Snapshots (upserts) the sale for a COMPLETED appointment: the doctor's
 * consultation fee + procedures, minus the discount, frozen so later edits /
 * price changes don't rewrite it. `occurred_at` = the visit date. Best-effort —
 * a ledger hiccup must never block the status change that triggered it.
 */
export async function recordSaleForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        doctorId: appointments.doctorId,
        scheduledAt: appointments.scheduledAt,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        fee: users.consultationFee,
        doctorName: users.fullName,
        doctorUsername: users.username,
        proceduresTotal: procTotalSql,
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(
        byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)),
      )
      .limit(1);
    if (!row) return;

    const { gross, discount, net } = computeAppointmentTotal(
      row.fee,
      Number(row.proceduresTotal),
      row.discountType === "percent" ? "percent" : "amount",
      row.discountValue,
    );
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
        fee: users.consultationFee,
        doctorName: users.fullName,
        doctorUsername: users.username,
        proceduresTotal: procTotalSql,
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .leftJoin(sales, eq(sales.appointmentId, appointments.id))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          and(eq(appointments.status, "completed"), isNull(sales.id)),
        ),
      );
    if (rows.length === 0) return;

    const values = rows.map((r) => {
      const { gross, discount, net } = computeAppointmentTotal(
        r.fee,
        Number(r.proceduresTotal),
        r.discountType === "percent" ? "percent" : "amount",
        r.discountValue,
      );
      return {
        clinicId,
        appointmentId: r.id,
        doctorId: r.doctorId ?? null,
        doctorName: r.doctorName ?? r.doctorUsername ?? null,
        grossAmount: gross,
        discountAmount: discount,
        netAmount: net,
        occurredAt: r.scheduledAt,
      };
    });
    await db.insert(sales).values(values).onConflictDoNothing({
      target: sales.appointmentId,
    });
  } catch {
    // best-effort
  }
}
