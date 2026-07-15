import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { doctorProcedureShares, procedures, users } from "@/core/db/schema";
import type { DoctorShareRates } from "@/core/appointments/shares";

/**
 * Doctor share CONFIG — reads/writes the per-doctor rates used by `computeShare`.
 * The rates themselves live on `users` (consultation % + default procedure %) plus
 * the `doctor_procedure_shares` overrides (procedureId → %). Kept clinic-scoped so
 * a foreign doctor/procedure id can never leak or be written.
 */

/** A per-procedure override row for the config form (procedureId → % share). */
export type DoctorProcedureOverride = { procedureId: string; sharePct: number };

/**
 * Resolve a doctor's full rate set for `computeShare`: their consultation % and
 * default procedure % (from `users`) plus every per-procedure override. A missing
 * doctor yields all-zero rates (they simply earn nothing). Clinic-scoped.
 */
export async function getDoctorShareRates(
  clinicId: string,
  doctorId: string,
): Promise<DoctorShareRates> {
  const [row] = await db
    .select({
      consultationPct: users.consultationSharePct,
      defaultProcedurePct: users.procedureSharePct,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, doctorId)))
    .limit(1);

  const overrides = await getDoctorProcedureOverrides(clinicId, doctorId);
  const map: Record<string, number> = {};
  for (const o of overrides) map[o.procedureId] = o.sharePct;

  return {
    consultationPct: row?.consultationPct ?? 0,
    defaultProcedurePct: row?.defaultProcedurePct ?? 0,
    overrides: map,
  };
}

/**
 * Rate sets for MANY doctors at once (the appointment split needs each performing
 * doctor's rates). Returns a Map keyed by doctorId; a doctor with no row is absent.
 * One query per table (not per doctor) so an appointment with several doctors stays
 * cheap.
 */
export async function getDoctorShareRatesMany(
  clinicId: string,
  doctorIds: string[],
): Promise<Map<string, DoctorShareRates>> {
  const ids = [...new Set(doctorIds.filter(Boolean))];
  const out = new Map<string, DoctorShareRates>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      id: users.id,
      consultationPct: users.consultationSharePct,
      defaultProcedurePct: users.procedureSharePct,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, inArray(users.id, ids)));
  for (const r of rows) {
    out.set(r.id, {
      consultationPct: r.consultationPct,
      defaultProcedurePct: r.defaultProcedurePct,
      overrides: {},
    });
  }

  const ov = await db
    .select({
      doctorId: doctorProcedureShares.doctorId,
      procedureId: doctorProcedureShares.procedureId,
      sharePct: doctorProcedureShares.sharePct,
    })
    .from(doctorProcedureShares)
    .where(
      byClinic(
        doctorProcedureShares.clinicId,
        clinicId,
        inArray(doctorProcedureShares.doctorId, ids),
      ),
    );
  for (const o of ov) {
    const rates = out.get(o.doctorId);
    if (rates) rates.overrides[o.procedureId] = o.sharePct;
  }
  return out;
}

/** A doctor's per-procedure overrides (for the config-form prefill). Clinic-scoped. */
export async function getDoctorProcedureOverrides(
  clinicId: string,
  doctorId: string,
): Promise<DoctorProcedureOverride[]> {
  return db
    .select({
      procedureId: doctorProcedureShares.procedureId,
      sharePct: doctorProcedureShares.sharePct,
    })
    .from(doctorProcedureShares)
    .where(
      byClinic(
        doctorProcedureShares.clinicId,
        clinicId,
        eq(doctorProcedureShares.doctorId, doctorId),
      ),
    );
}

/**
 * Replace ALL of a doctor's per-procedure overrides with `overrides` (clinic-
 * scoped). Delete-then-insert so removed rows disappear. Only ids that belong to
 * this clinic's live procedures are kept; each % is clamped to 0–100. A stored 0
 * is meaningful (0% — distinct from having no row → the default rate).
 */
export async function replaceDoctorProcedureShares(
  clinicId: string,
  doctorId: string,
  overrides: DoctorProcedureOverride[],
): Promise<void> {
  await db
    .delete(doctorProcedureShares)
    .where(
      byClinic(
        doctorProcedureShares.clinicId,
        clinicId,
        eq(doctorProcedureShares.doctorId, doctorId),
      ),
    );

  // Collapse dupes (last wins), then keep only real, live, clinic-owned procedures.
  const byId = new Map<string, number>();
  for (const o of overrides) {
    if (o.procedureId) byId.set(o.procedureId, Math.max(0, Math.min(100, Math.round(o.sharePct))));
  }
  const ids = [...byId.keys()];
  if (ids.length === 0) return;

  const valid = await db
    .select({ id: procedures.id })
    .from(procedures)
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        inArray(procedures.id, ids),
      ),
    );
  if (valid.length === 0) return;

  await db.insert(doctorProcedureShares).values(
    valid.map((p) => ({
      clinicId,
      doctorId,
      procedureId: p.id,
      sharePct: byId.get(p.id)!,
    })),
  );
}
