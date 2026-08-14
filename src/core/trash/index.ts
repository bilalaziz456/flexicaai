import "server-only";

import type { ModuleTrash, ModuleTrashRow } from "@/core/types/module";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  doctorLeaves,
  expenses,
  patients,
  procedures,
  recalls,
  users,
  visits,
} from "@/core/db/schema";
import { restoreValues } from "@/core/db/soft-delete";
import {
  backfillClinicSales,
  recordSaleForAppointment,
  voidSaleForAppointment,
} from "@/core/sales/ledger";

/**
 * Trash — CORE. Nothing is hard-deleted (except a super-admin legal purge), so a
 * "delete" leaves the row with `deleted_at` set. This module lists trashed items,
 * restores them (reverting the whole delete group so cascades come back together),
 * and — super-admin only — purges them for good.
 *
 * A Trash ENTRY is a directly-deleted row (`deleted_by_cascade = false`). The rows
 * its deletion cascade-hid share its `delete_group` and are restored/purged with it
 * but never listed on their own.
 */

export type TrashEntity =
  | "clinical_record"
  | "patient"
  | "appointment"
  | "visit"
  | "recall"
  | "procedure"
  | "expense"
  | "leave"
  | "staff"
  | "clinic";

export type TrashItem = {
  entity: TrashEntity;
  id: string;
  group: string;
  label: string;
  detail: string | null;
  clinicId: string | null;
  clinicName: string | null;
  deletedAt: Date;
  deletedById: string | null;
  deletedByName: string | null;
};

const dateStr = (d: Date | string | null): string => {
  if (!d) return "";
  const dd = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return dd.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

type Scope =
  | { kind: "clinic"; clinicId: string; cutoff: Date }
  | { kind: "all" };

/**
 * Optional Trash filters (all combine with AND). `q` is a free-text match on the
 * built label/detail (applied after the queries, since labels span columns);
 * `type` narrows to one record kind; `deletedBy` to one actor; `from`/`toExclusive`
 * to a deletion-date window; `clinicId` (super admin only) to one clinic.
 */
export type TrashFilters = {
  q?: string;
  type?: TrashEntity | "";
  deletedBy?: string;
  from?: Date;
  toExclusive?: Date;
  clinicId?: string;
};

/**
 * Collects the trashed ENTRIES for a scope. For a clinic it is that clinic's rows
 * within its retention window; for the super admin it is every trashed row across
 * all clinics (no window), including trashed clinics themselves. `filters` narrow
 * the set (type / actor / date range / clinic / text search).
 */
async function collect(
  scope: Scope,
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
): Promise<TrashItem[]> {
  const wantType = (e: TrashEntity) => !filters.type || filters.type === e;

  // Per-entity WHERE: directly-deleted rows, plus scope (clinic + retention window,
  // or the super admin's optional clinic filter) and the shared filters. A
  // type-excluded entity gets `false` so it returns nothing but keeps its result
  // shape (simpler than skipping the query).
  const cond = (
    entity: TrashEntity,
    clinicCol: PgColumn,
    deletedCol: PgColumn,
    cascadeCol: PgColumn,
    byCol: PgColumn,
  ): SQL | undefined => {
    if (!wantType(entity)) return sql`false`;
    const parts: (SQL | undefined)[] = [isNotNull(deletedCol), eq(cascadeCol, false)];
    if (scope.kind === "clinic") {
      parts.push(eq(clinicCol, scope.clinicId));
      parts.push(gte(deletedCol, scope.cutoff));
    } else if (filters.clinicId) {
      parts.push(eq(clinicCol, filters.clinicId));
    }
    if (filters.deletedBy) parts.push(eq(byCol, filters.deletedBy));
    if (filters.from) parts.push(gte(deletedCol, filters.from));
    if (filters.toExclusive) parts.push(lt(deletedCol, filters.toExclusive));
    return and(...parts);
  };

  // Each entity is queried separately (label/detail differ).
  const [pats, appts, vis, recs, procs, exps, leaves, staff, clins] = await Promise.all([
    db
      .select({
        id: patients.id,
        group: patients.deleteGroup,
        deletedAt: patients.deletedAt,
        deletedBy: patients.deletedBy,
        clinicId: patients.clinicId,
        name: patients.fullName,
      })
      .from(patients)
      .where(cond("patient", patients.clinicId, patients.deletedAt, patients.deletedByCascade, patients.deletedBy))
      .orderBy(desc(patients.deletedAt)),
    db
      .select({
        id: appointments.id,
        group: appointments.deleteGroup,
        deletedAt: appointments.deletedAt,
        deletedBy: appointments.deletedBy,
        clinicId: appointments.clinicId,
        scheduledAt: appointments.scheduledAt,
        patientName: patients.fullName,
      })
      .from(appointments)
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .where(cond("appointment", appointments.clinicId, appointments.deletedAt, appointments.deletedByCascade, appointments.deletedBy))
      .orderBy(desc(appointments.deletedAt)),
    db
      .select({
        id: visits.id,
        group: visits.deleteGroup,
        deletedAt: visits.deletedAt,
        deletedBy: visits.deletedBy,
        clinicId: visits.clinicId,
        visitDate: visits.visitDate,
        patientName: patients.fullName,
      })
      .from(visits)
      .leftJoin(patients, eq(visits.patientId, patients.id))
      .where(cond("visit", visits.clinicId, visits.deletedAt, visits.deletedByCascade, visits.deletedBy))
      .orderBy(desc(visits.deletedAt)),
    db
      .select({
        id: recalls.id,
        group: recalls.deleteGroup,
        deletedAt: recalls.deletedAt,
        deletedBy: recalls.deletedBy,
        clinicId: recalls.clinicId,
        reason: recalls.reason,
        patientName: patients.fullName,
      })
      .from(recalls)
      .leftJoin(patients, eq(recalls.patientId, patients.id))
      .where(cond("recall", recalls.clinicId, recalls.deletedAt, recalls.deletedByCascade, recalls.deletedBy))
      .orderBy(desc(recalls.deletedAt)),
    db
      .select({
        id: procedures.id,
        group: procedures.deleteGroup,
        deletedAt: procedures.deletedAt,
        deletedBy: procedures.deletedBy,
        clinicId: procedures.clinicId,
        name: procedures.name,
        price: procedures.price,
      })
      .from(procedures)
      .where(cond("procedure", procedures.clinicId, procedures.deletedAt, procedures.deletedByCascade, procedures.deletedBy))
      .orderBy(desc(procedures.deletedAt)),
    db
      .select({
        id: expenses.id,
        group: expenses.deleteGroup,
        deletedAt: expenses.deletedAt,
        deletedBy: expenses.deletedBy,
        clinicId: expenses.clinicId,
        amount: expenses.amount,
        incurredOn: expenses.incurredOn,
        vendor: expenses.vendor,
        note: expenses.note,
      })
      .from(expenses)
      .where(cond("expense", expenses.clinicId, expenses.deletedAt, expenses.deletedByCascade, expenses.deletedBy))
      .orderBy(desc(expenses.deletedAt)),
    db
      .select({
        id: doctorLeaves.id,
        group: doctorLeaves.deleteGroup,
        deletedAt: doctorLeaves.deletedAt,
        deletedBy: doctorLeaves.deletedBy,
        clinicId: doctorLeaves.clinicId,
        startDate: doctorLeaves.startDate,
        endDate: doctorLeaves.endDate,
        doctorName: users.fullName,
        doctorUsername: users.username,
      })
      .from(doctorLeaves)
      .leftJoin(users, eq(doctorLeaves.doctorId, users.id))
      .where(cond("leave", doctorLeaves.clinicId, doctorLeaves.deletedAt, doctorLeaves.deletedByCascade, doctorLeaves.deletedBy))
      .orderBy(desc(doctorLeaves.deletedAt)),
    db
      .select({
        id: users.id,
        group: users.deleteGroup,
        deletedAt: users.deletedAt,
        deletedBy: users.deletedBy,
        clinicId: users.clinicId,
        fullName: users.fullName,
        username: users.username,
        role: users.role,
      })
      .from(users)
      .where(cond("staff", users.clinicId, users.deletedAt, users.deletedByCascade, users.deletedBy))
      .orderBy(desc(users.deletedAt)),
    // Clinics only appear in the super-admin (all) scope. Its own id is the
    // "clinic" column for the clinic filter.
    scope.kind === "all"
      ? db
          .select({
            id: clinics.id,
            group: clinics.deleteGroup,
            deletedAt: clinics.deletedAt,
            deletedBy: clinics.deletedBy,
            name: clinics.name,
          })
          .from(clinics)
          .where(cond("clinic", clinics.id, clinics.deletedAt, clinics.deletedByCascade, clinics.deletedBy))
          .orderBy(desc(clinics.deletedAt))
      : Promise.resolve([] as { id: string; group: string | null; deletedAt: Date | null; deletedBy: string | null; name: string }[]),
  ]);

  const items: TrashItem[] = [];
  const push = (it: Omit<TrashItem, "clinicName" | "deletedByName">) =>
    items.push({ ...it, clinicName: null, deletedByName: null });

  for (const r of pats)
    push({ entity: "patient", id: r.id, group: r.group ?? r.id, label: r.name, detail: null, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of appts)
    push({ entity: "appointment", id: r.id, group: r.group ?? r.id, label: r.patientName ?? "Appointment", detail: r.scheduledAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of vis)
    push({ entity: "visit", id: r.id, group: r.group ?? r.id, label: r.patientName ? `${r.patientName} · clinical note` : "Clinical note", detail: dateStr(r.visitDate), clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of recs)
    push({ entity: "recall", id: r.id, group: r.group ?? r.id, label: r.patientName ? `${r.patientName} · recall` : (r.reason ?? "Recall"), detail: r.reason, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of procs)
    push({ entity: "procedure", id: r.id, group: r.group ?? r.id, label: r.name, detail: `Rs ${r.price}`, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of exps)
    push({ entity: "expense", id: r.id, group: r.group ?? r.id, label: r.vendor || r.note || "Expense", detail: `Rs ${r.amount} · ${dateStr(r.incurredOn)}`, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of leaves)
    push({ entity: "leave", id: r.id, group: r.group ?? r.id, label: `${r.doctorName ?? r.doctorUsername ?? "Doctor"} · leave`, detail: r.startDate === r.endDate ? dateStr(r.startDate) : `${dateStr(r.startDate)} – ${dateStr(r.endDate)}`, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of staff)
    push({ entity: "staff", id: r.id, group: r.group ?? r.id, label: r.fullName ?? r.username, detail: r.role, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of clins)
    push({ entity: "clinic", id: r.id, group: r.group ?? r.id, label: r.name, detail: "Whole clinic + all its data", clinicId: r.id, deletedAt: r.deletedAt!, deletedById: r.deletedBy });

  // Module rows (e.g. a dental chart entry) are fetched by the app layer, because a
  // specialty table must never be imported here. They are already scoped and
  // window-filtered; only the shared type/actor/date filters still apply.
  for (const r of moduleRows) {
    if (filters.type && filters.type !== "clinical_record") break;
    if (filters.deletedBy && r.deletedById !== filters.deletedBy) continue;
    if (filters.from && r.deletedAt < filters.from) continue;
    if (filters.toExclusive && r.deletedAt >= filters.toExclusive) continue;
    if (filters.clinicId && r.clinicId !== filters.clinicId) continue;
    push({
      entity: "clinical_record",
      id: r.id,
      group: r.group,
      label: r.label,
      detail: r.detail,
      clinicId: r.clinicId,
      deletedAt: r.deletedAt,
      deletedById: r.deletedById,
    });
  }

  // Resolve deleter names (users may themselves be trashed — no notDeleted filter)
  // and clinic names (super-admin scope), in one query each.
  const actorIds = [...new Set(items.map((i) => i.deletedById).filter((x): x is string => Boolean(x)))];
  if (actorIds.length) {
    const actors = await db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(inArray(users.id, actorIds));
    const nameById = new Map(actors.map((a) => [a.id, a.fullName ?? a.username]));
    for (const it of items) it.deletedByName = it.deletedById ? nameById.get(it.deletedById) ?? null : null;
  }

  if (scope.kind === "all") {
    const clinicIds = [...new Set(items.map((i) => i.clinicId).filter((x): x is string => Boolean(x)))];
    if (clinicIds.length) {
      const rows = await db
        .select({ id: clinics.id, name: clinics.name })
        .from(clinics)
        .where(inArray(clinics.id, clinicIds));
      const byId = new Map(rows.map((c) => [c.id, c.name]));
      for (const it of items) it.clinicName = it.clinicId ? byId.get(it.clinicId) ?? null : null;
    }
  }

  // Free-text search runs last (labels/details span columns, so it can't be one
  // SQL predicate) — match label, detail, deleter, or clinic name.
  const q = filters.q?.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) =>
        [it.label, it.detail, it.deletedByName, it.clinicName]
          .some((s) => s?.toLowerCase().includes(q)),
      )
    : items;

  return filtered.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** A clinic admin's Trash: this clinic's entries within its retention window. */
export async function listClinicTrash(
  clinicId: string,
  retentionDays: number,
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
): Promise<TrashItem[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return collect({ kind: "clinic", clinicId, cutoff }, filters, moduleRows);
}

/** The super admin's Trash: every trashed entry across all clinics, no window. */
export async function listAllTrash(
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
): Promise<TrashItem[]> {
  return collect({ kind: "all" }, filters, moduleRows);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TRASH_ENTITIES: readonly TrashEntity[] = [
  "patient",
  "clinical_record",
  "appointment",
  "visit",
  "recall",
  "procedure",
  "expense",
  "leave",
  "staff",
  "clinic",
];

function localMidnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parses the Trash URL filters. Unlike the activity log, the date range does NOT
 * default to today (that would hide older trash) — an empty range means "no date
 * filter". Returns both the `TrashFilters` for the query and the raw strings the
 * filter bar renders.
 */
export function parseTrashFilters(sp: {
  q?: string;
  type?: string;
  by?: string;
  from?: string;
  to?: string;
  clinic?: string;
}): {
  filters: TrashFilters;
  ui: { q: string; type: string; by: string; from: string; to: string; clinic: string };
} {
  const q = (sp.q ?? "").trim();
  const by = (sp.by ?? "").trim();
  const clinic = (sp.clinic ?? "").trim();
  const typeRaw = (sp.type ?? "").trim();
  const type = (TRASH_ENTITIES as readonly string[]).includes(typeRaw)
    ? (typeRaw as TrashEntity)
    : "";
  let fromStr = sp.from && YMD.test(sp.from) ? sp.from : "";
  let toStr = sp.to && YMD.test(sp.to) ? sp.to : "";
  if (fromStr && toStr && fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];

  const from = fromStr ? localMidnight(fromStr) : undefined;
  let toExclusive: Date | undefined;
  if (toStr) {
    toExclusive = localMidnight(toStr);
    toExclusive.setDate(toExclusive.getDate() + 1); // inclusive of the "to" day
  }

  return {
    filters: {
      q,
      type,
      deletedBy: by || undefined,
      from,
      toExclusive,
      clinicId: clinic || undefined,
    },
    ui: { q, type, by, from: fromStr, to: toStr, clinic },
  };
}

// ---- Restore --------------------------------------------------------------

/**
 * Reverts every row in a delete group (parent + the children its deletion hid).
 * `clinicId` scopes a clinic restore to its own rows; `null` = super-admin (any).
 * Completed appointments that come back re-snapshot their sale; a restored clinic
 * re-backfills its whole ledger. Returns the restored appointment ids so sales can
 * be re-synced.
 */
async function revertGroup(group: string, clinicId: string | null): Promise<void> {
  const set = restoreValues();

  // Tenant tables (all carry clinic_id + delete_group).
  const restoredAppts = await db
    .update(appointments)
    .set(set)
    .where(clinicId ? and(eq(appointments.deleteGroup, group), eq(appointments.clinicId, clinicId)) : eq(appointments.deleteGroup, group))
    .returning({ id: appointments.id, clinicId: appointments.clinicId, status: appointments.status });

  await db.update(patients).set(set).where(clinicId ? and(eq(patients.deleteGroup, group), eq(patients.clinicId, clinicId)) : eq(patients.deleteGroup, group));
  await db.update(visits).set(set).where(clinicId ? and(eq(visits.deleteGroup, group), eq(visits.clinicId, clinicId)) : eq(visits.deleteGroup, group));
  await db.update(recalls).set(set).where(clinicId ? and(eq(recalls.deleteGroup, group), eq(recalls.clinicId, clinicId)) : eq(recalls.deleteGroup, group));
  await db.update(procedures).set(set).where(clinicId ? and(eq(procedures.deleteGroup, group), eq(procedures.clinicId, clinicId)) : eq(procedures.deleteGroup, group));
  await db.update(expenses).set(set).where(clinicId ? and(eq(expenses.deleteGroup, group), eq(expenses.clinicId, clinicId)) : eq(expenses.deleteGroup, group));
  await db.update(doctorLeaves).set(set).where(clinicId ? and(eq(doctorLeaves.deleteGroup, group), eq(doctorLeaves.clinicId, clinicId)) : eq(doctorLeaves.deleteGroup, group));
  await db.update(users).set(set).where(clinicId ? and(eq(users.deleteGroup, group), eq(users.clinicId, clinicId)) : eq(users.deleteGroup, group));

  // Super-admin scope can also restore the clinic row itself.
  let restoredClinicId: string | null = null;
  if (!clinicId) {
    const [c] = await db
      .update(clinics)
      .set(set)
      .where(eq(clinics.deleteGroup, group))
      .returning({ id: clinics.id });
    restoredClinicId = c?.id ?? null;
  }

  // Re-sync the sales ledger: a whole restored clinic re-backfills; otherwise each
  // restored completed appointment re-snapshots its sale.
  if (restoredClinicId) {
    await backfillClinicSales(restoredClinicId);
  } else {
    for (const a of restoredAppts) {
      if (a.status === "completed") await recordSaleForAppointment(a.clinicId, a.id);
    }
  }
}

/** Clinic-scoped restore of a group (only rows belonging to `clinicId`). */
export async function restoreForClinic(
  clinicId: string,
  group: string,
  moduleTrash?: Pick<ModuleTrash, "restore">,
): Promise<void> {
  await revertGroup(group, clinicId);
  await moduleTrash?.restore(group, clinicId);
}

/** Super-admin restore of a group (any clinic, and the clinic row itself). */
export async function restoreGlobal(
  group: string,
  moduleTrash?: Pick<ModuleTrash, "restore">,
): Promise<void> {
  await revertGroup(group, null);
  await moduleTrash?.restore(group, null);
}

// ---- Purge (super-admin legal erasure only) -------------------------------

/**
 * PHYSICALLY deletes every row in a delete group — the ONLY hard delete in the
 * app, reserved for a legal erasure request and gated to the super admin at the
 * action layer. FK cascades remove dependent rows (appointment procedures, sales,
 * a clinic's whole tree), so we delete leaf→root and let the DB do the rest.
 */
export async function purgeGroup(
  group: string,
  moduleTrash?: Pick<ModuleTrash, "purge">,
): Promise<void> {
  // A module's own rows first: they reference core tables, so they must go before
  // the rows they point at.
  await moduleTrash?.purge(group);
  await db.transaction(async (tx) => {
    // Void sales for the group's appointments first (sales has no group column).
    const appts = await tx.select({ id: appointments.id, clinicId: appointments.clinicId }).from(appointments).where(eq(appointments.deleteGroup, group));
    for (const a of appts) await voidSaleForAppointment(a.clinicId, a.id);

    await tx.delete(visits).where(eq(visits.deleteGroup, group));
    await tx.delete(recalls).where(eq(recalls.deleteGroup, group));
    await tx.delete(appointments).where(eq(appointments.deleteGroup, group));
    await tx.delete(doctorLeaves).where(eq(doctorLeaves.deleteGroup, group));
    await tx.delete(expenses).where(eq(expenses.deleteGroup, group));
    await tx.delete(procedures).where(eq(procedures.deleteGroup, group));
    await tx.delete(patients).where(eq(patients.deleteGroup, group));
    await tx.delete(users).where(eq(users.deleteGroup, group));
    // Deleting the clinic cascades anything left under it.
    await tx.delete(clinics).where(eq(clinics.deleteGroup, group));
  });
}
