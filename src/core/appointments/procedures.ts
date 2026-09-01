import "server-only";

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  appointmentProcedures,
  clinics,
  procedures,
  users,
} from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { clampDiscountValue, type DiscountType } from "@/core/appointments/fee";
import { discountTypeId, type DiscountTypeCode } from "@/core/db/vocabulary-seed";

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
 * Mirrors `computeProcedureLine` exactly — enforced by `scripts/test-bill-parity.ts`,
 * not by this comment. Use inside a `sum(...)` (grouped) or the correlated helper
 * below. The appointment-level half of the formula lives in `bill-sql.ts`.
 *
 * The percent multiply runs in NUMERIC for the same reason as the appointment-level
 * discount: per-line `discount_value` is unbounded, and `gross * value` overflows
 * int4 on a large percentage, which makes Postgres throw where TS would clamp.
 */
/**
 * The OUTER `appointments.id`, spelled out, for the correlated subqueries below.
 *
 * WHY NOT `${appointments.id}`: Drizzle only qualifies a column when it thinks the
 * query needs it. In a JOINed query it emits `"appointments"."id"` and everything
 * works — which is every production call site, so this was invisible. In a
 * single-table `from(appointments)` query it emits a bare `"id"`, and inside the
 * subquery that binds to `appointment_procedures.id` instead: a correlation that
 * matches nothing and returns 0 / NULL rather than raising. A money figure that is
 * silently zero is the worst shape of bug, so the reference is pinned here.
 */
const outerAppointmentId = sql`${sql.identifier("appointments")}.${sql.identifier("id")}`;

export function procedureRowNetSql(): SQL<number> {
  const gross = sql`(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})`;
  return sql<number>`(${gross} - least(greatest(round(case when ${appointmentProcedures.discountType} = ${discountTypeId("percent")} then ${gross}::numeric * ${appointmentProcedures.discountValue} / 100.0 else ${appointmentProcedures.discountValue}::numeric end), 0), ${gross}))::int`;
}

/** Correlated Σ of per-row NET for the OUTER `appointments.id` (0 when none). */
export function appointmentProceduresNetSql(): SQL<number> {
  return sql<number>`coalesce((select sum(${procedureRowNetSql()})::int from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${outerAppointmentId}), 0)`;
}

/** Correlated Σ of per-row GROSS (unit×qty) for the OUTER `appointments.id`. */
export function appointmentProceduresGrossSql(): SQL<number> {
  return sql<number>`coalesce((select sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})::int from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${outerAppointmentId}), 0)`;
}

/**
 * Correlated comma-joined procedure NAMES for the OUTER `appointments.id` (NULL when
 * none) — for telling the patient what their visit is FOR, in the WhatsApp
 * confirmation and reminder.
 *
 * Reads the snapshot `appointment_procedures.name`, never the catalog: renaming a
 * procedure must not rewrite what a patient was already told. A quantity above 1 is
 * shown as "Filling ×2", since "Filling" alone understates a two-tooth visit.
 */
export function appointmentProcedureNamesSql(): SQL<string | null> {
  return sql<string | null>`(
    select string_agg(
      ${appointmentProcedures.name} || case when ${appointmentProcedures.quantity} > 1
        then ' ×' || ${appointmentProcedures.quantity} else '' end,
      ', ' order by ${appointmentProcedures.name}
    )
    from ${appointmentProcedures}
    where ${appointmentProcedures.appointmentId} = ${outerAppointmentId}
  )`;
}

/** Correlated EXISTS — does the OUTER `appointments.id` have any procedure line? */
export function appointmentHasProceduresSql(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${appointmentProcedures} where ${appointmentProcedures.appointmentId} = ${outerAppointmentId})`;
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
        // The literals are pinned: inside a .map() TypeScript widens the ternary to
        // `string`, which the column no longer accepts.
        discountType: (s.discountType === "percent" ? "percent" : "amount") as DiscountTypeCode,
        // Clamped HERE, not just at the form: this is the single write path for a
        // procedure line, so a caller that skipped validation still can't store a
        // percentage above 100 (D-17). A flat amount stays unbounded — the bill
        // clamps it, and a large write-off is legitimate.
        discountValue: clampDiscountValue(
          s.discountType === "percent" ? "percent" : "amount",
          s.discountValue,
        ),
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

/**
 * The clinic's procedure catalog — CORE per ADR-014. Newest first, matching the
 * matching the catalog page so the export is the same list the user was looking at.
 */
export async function listProcedureCatalog(clinicId: string) {
  return db
    .select({
      id: procedures.id,
      name: procedures.name,
      price: procedures.price,
      isActive: procedures.isActive,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)))
    .orderBy(desc(procedures.createdAt));
}

/** Adds one priced procedure to the clinic's catalog. Returns its id. */
export async function createProcedure(
  clinicId: string,
  input: { name: string; price: number; module: string | null },
): Promise<string> {
  const [row] = await db
    .insert(procedures)
    .values({ clinicId, ...input })
    .returning({ id: procedures.id });
  return row.id;
}

/** Edits a procedure. Returns false when the id is not this clinic's (or trashed). */
export async function updateProcedure(
  clinicId: string,
  procedureId: string,
  input: { name: string; price: number; isActive: boolean },
): Promise<boolean> {
  const rows = await db
    .update(procedures)
    .set({ ...input, updatedAt: new Date() })
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        eq(procedures.id, procedureId),
      ),
    )
    .returning({ id: procedures.id });
  return rows.length > 0;
}

/**
 * Trashes a procedure. Past appointments keep their SNAPSHOTTED name and price
 * (`appointment_procedures`), so removing one from the catalog never rewrites a bill
 * that was already issued.
 */
export async function softDeleteProcedure(
  clinicId: string,
  procedureId: string,
  actorId: string,
): Promise<void> {
  await db
    .update(procedures)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        eq(procedures.id, procedureId),
      ),
    );
}

/**
 * Seeds the catalog from the module's suggested defaults, skipping any the clinic
 * already has BY NAME (case-insensitively).
 *
 * The name match is what makes this safe to run twice: a clinic that already added
 * "Scaling" by hand must not end up with two, and matching on name is the only handle
 * available since a template has no id in the clinic's catalog.
 */
export async function addMissingProcedures(
  clinicId: string,
  templates: { name: string; price: number }[],
  module: string | null,
): Promise<number> {
  if (templates.length === 0) return 0;
  const existing = await db
    .select({ name: procedures.name })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)));
  const have = new Set(existing.map((p) => p.name.toLowerCase()));
  const toAdd = templates.filter((t) => !have.has(t.name.toLowerCase()));
  if (toAdd.length === 0) return 0;
  await db
    .insert(procedures)
    .values(toAdd.map((t) => ({ clinicId, name: t.name, price: t.price, module })));
  return toAdd.length;
}
