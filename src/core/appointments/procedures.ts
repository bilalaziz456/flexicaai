import "server-only";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import {
  appointmentProcedures,
  appointments,
  clinics,
  procedures,
  users,
} from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import type { DiscountType } from "@/core/appointments/fee";

export type BookingProcedure = { id: string; name: string; price: number };

/**
 * One procedure line on an appointment — quantity (≥ 1) + its own discount, plus
 * the PERFORMING doctor (who earns that line's revenue share). `doctorId` null =
 * no doctor (the clinic keeps it); the booking form defaults it to the consulting
 * doctor.
 */
export type ProcedureSelection = {
  procedureId: string;
  quantity: number;
  discountType: DiscountType;
  discountValue: number;
  doctorId?: string | null;
};

/** A saved appointment line item (snapshotted name + price + quantity + discount). */
export type AppointmentProcedureItem = {
  procedureId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  discountType: DiscountType;
  discountValue: number;
  doctorId: string | null;
};

/** Clamp a raw quantity to a sane whole number in [1, 99]. */
function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 1;
  return Math.max(1, Math.min(99, Math.round(q)));
}

/**
 * SQL for a procedure row's NET (line gross − its clamped per-line discount).
 * Mirrors `computeProcedureLine` exactly so the DB aggregates and the JS bill can
 * never drift. Use inside a `sum(...)` (grouped) or the correlated helper below.
 */
export function procedureRowNetSql(): SQL<number> {
  const gross = sql`(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})`;
  return sql<number>`(${gross} - least(greatest(case when ${appointmentProcedures.discountType} = 'percent' then round(${gross} * ${appointmentProcedures.discountValue} / 100.0) else ${appointmentProcedures.discountValue} end, 0), ${gross}))`;
}

/** Correlated Σ of per-row NET for the OUTER `appointments.id` (0 when none). */
export function appointmentProceduresNetSql(): SQL<number> {
  return sql<number>`coalesce((select sum(${procedureRowNetSql()})::int from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${appointments.id}), 0)`;
}

/** Correlated Σ of per-row GROSS (unit×qty) for the OUTER `appointments.id`. */
export function appointmentProceduresGrossSql(): SQL<number> {
  return sql<number>`coalesce((select sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})::int from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${appointments.id}), 0)`;
}

/** Correlated EXISTS — does the OUTER `appointments.id` have any procedure line? */
export function appointmentHasProceduresSql(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${appointments.id})`;
}

/**
 * A clinic's ACTIVE procedures for the booking picker — but only when the
 * clinic has the `sales` feature on (otherwise appointments stay fee-only and
 * the picker is hidden). Ordered by name.
 */
export async function getBookingProcedures(
  clinicId: string,
): Promise<BookingProcedure[]> {
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) return [];

  return db
    .select({ id: procedures.id, name: procedures.name, price: procedures.price })
    .from(procedures)
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        eq(procedures.isActive, true),
      ),
    )
    .orderBy(asc(procedures.name));
}

/**
 * Replaces an appointment's procedure line items with `selections`
 * (clinic-scoped). Snapshots each procedure's CURRENT name + price + the chosen
 * quantity + its per-line discount so later catalog edits never rewrite this
 * appointment. Deletes the existing items first, so it's used for both create and
 * edit. Duplicate ids collapse to the last selection; unknown/foreign ids drop.
 */
export async function saveAppointmentProcedures(
  clinicId: string,
  appointmentId: string,
  selections: ProcedureSelection[],
): Promise<void> {
  await db
    .delete(appointmentProcedures)
    .where(
      byClinic(
        appointmentProcedures.clinicId,
        clinicId,
        eq(appointmentProcedures.appointmentId, appointmentId),
      ),
    );

  // One row per procedure (the form never dupes; last wins if it somehow does).
  const byId = new Map<string, ProcedureSelection>();
  for (const s of selections) {
    if (!s.procedureId) continue;
    byId.set(s.procedureId, s);
  }
  const ids = [...byId.keys()];
  if (ids.length === 0) return;

  const rows = await db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
    })
    .from(procedures)
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        inArray(procedures.id, ids),
      ),
    );
  if (rows.length === 0) return;

  // Validate performing-doctor ids against THIS clinic's doctors (tenant isolation);
  // an unknown/foreign id is dropped to null (the clinic keeps that line's share).
  const wantDoctorIds = [
    ...new Set(rows.map((r) => byId.get(r.id)?.doctorId).filter((v): v is string => Boolean(v))),
  ];
  const validDoctors = new Set<string>();
  if (wantDoctorIds.length > 0) {
    const drs = await db
      .select({ id: users.id })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          and(eq(users.role, "doctor"), inArray(users.id, wantDoctorIds)),
        ),
      );
    for (const d of drs) validDoctors.add(d.id);
  }

  await db.insert(appointmentProcedures).values(
    rows.map((r) => {
      const s = byId.get(r.id)!;
      const doctorId = s.doctorId && validDoctors.has(s.doctorId) ? s.doctorId : null;
      return {
        clinicId,
        appointmentId,
        procedureId: r.id,
        doctorId,
        name: r.name,
        unitPrice: r.price,
        quantity: clampQty(s.quantity),
        discountType: s.discountType === "percent" ? "percent" : "amount",
        discountValue: Math.max(0, Math.round(s.discountValue || 0)),
      };
    }),
  );
}

/**
 * An appointment's saved procedure line items (name/price/quantity/discount
 * snapshots), ordered by name. Drives the edit-form prefill and the read-only bill.
 */
export async function getAppointmentProcedureItems(
  clinicId: string,
  appointmentId: string,
): Promise<AppointmentProcedureItem[]> {
  const rows = await db
    .select({
      procedureId: appointmentProcedures.procedureId,
      name: appointmentProcedures.name,
      unitPrice: appointmentProcedures.unitPrice,
      quantity: appointmentProcedures.quantity,
      discountType: appointmentProcedures.discountType,
      discountValue: appointmentProcedures.discountValue,
      doctorId: appointmentProcedures.doctorId,
    })
    .from(appointmentProcedures)
    .where(
      byClinic(
        appointmentProcedures.clinicId,
        clinicId,
        eq(appointmentProcedures.appointmentId, appointmentId),
      ),
    )
    .orderBy(asc(appointmentProcedures.name));
  return rows.map((r) => ({
    ...r,
    discountType: r.discountType === "percent" ? "percent" : "amount",
  }));
}
