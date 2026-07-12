import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointmentProcedures, clinics, procedures } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";

export type BookingProcedure = { id: string; name: string; price: number };

/** One procedure line on an appointment, chosen with a quantity (≥ 1). */
export type ProcedureSelection = { procedureId: string; quantity: number };

/** A saved appointment line item (snapshotted name + price + quantity). */
export type AppointmentProcedureItem = {
  procedureId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
};

/** Clamp a raw quantity to a sane whole number in [1, 99]. */
function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 1;
  return Math.max(1, Math.min(99, Math.round(q)));
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
      byClinic(procedures.clinicId, clinicId, eq(procedures.isActive, true)),
    )
    .orderBy(asc(procedures.name));
}

/**
 * Replaces an appointment's procedure line items with `selections`
 * (clinic-scoped). Snapshots each procedure's CURRENT name + price + the chosen
 * quantity so later catalog edits never rewrite this appointment. Deletes the
 * existing items first, so it's used for both create and edit. Duplicate ids are
 * merged (quantities summed); unknown/foreign ids are dropped.
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

  // Merge repeats and clamp quantities → one row per procedure.
  const qtyById = new Map<string, number>();
  for (const s of selections) {
    if (!s.procedureId) continue;
    qtyById.set(s.procedureId, clampQty((qtyById.get(s.procedureId) ?? 0) + s.quantity));
  }
  const ids = [...qtyById.keys()];
  if (ids.length === 0) return;

  const rows = await db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, inArray(procedures.id, ids)));
  if (rows.length === 0) return;

  await db.insert(appointmentProcedures).values(
    rows.map((r) => ({
      clinicId,
      appointmentId,
      procedureId: r.id,
      name: r.name,
      unitPrice: r.price,
      quantity: qtyById.get(r.id) ?? 1,
    })),
  );
}

/**
 * An appointment's saved procedure line items (name/price/quantity snapshots),
 * ordered by name. Drives both the edit-form prefill and the read-only bill.
 */
export async function getAppointmentProcedureItems(
  clinicId: string,
  appointmentId: string,
): Promise<AppointmentProcedureItem[]> {
  return db
    .select({
      procedureId: appointmentProcedures.procedureId,
      name: appointmentProcedures.name,
      unitPrice: appointmentProcedures.unitPrice,
      quantity: appointmentProcedures.quantity,
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
}
