import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointmentProcedures, clinics, procedures } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";

export type BookingProcedure = { id: string; name: string; price: number };

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
 * Replaces an appointment's procedure line items with `procedureIds`
 * (clinic-scoped). Snapshots each procedure's CURRENT name + price so later
 * catalog edits never rewrite this appointment. Deletes the existing items
 * first, so it's used for both create and edit. Unknown/foreign ids are dropped.
 */
export async function saveAppointmentProcedures(
  clinicId: string,
  appointmentId: string,
  procedureIds: string[],
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

  const uniqueIds = [...new Set(procedureIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const rows = await db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, inArray(procedures.id, uniqueIds)));
  if (rows.length === 0) return;

  await db.insert(appointmentProcedures).values(
    rows.map((r) => ({
      clinicId,
      appointmentId,
      procedureId: r.id,
      name: r.name,
      unitPrice: r.price,
      quantity: 1,
    })),
  );
}

/** The procedure ids currently attached to an appointment (for edit prefill). */
export async function getAppointmentProcedureIds(
  clinicId: string,
  appointmentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ procedureId: appointmentProcedures.procedureId })
    .from(appointmentProcedures)
    .where(
      byClinic(
        appointmentProcedures.clinicId,
        clinicId,
        eq(appointmentProcedures.appointmentId, appointmentId),
      ),
    );
  return rows.map((r) => r.procedureId).filter((id): id is string => Boolean(id));
}
