import "server-only";

import type { ModuleTrash, ModuleTrashRow } from "@/core/types/module";
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
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
import { unscoped } from "@/core/db/tenant-guard";
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
 * row's own text, its deleter's name or its clinic's name — pushed into SQL, because
 * a filter applied after the page is cut returns short pages and a wrong total.
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

/** One page of Trash, plus the total across every source so the pager can size itself. */
export type TrashPage = { items: TrashItem[]; total: number };

/** Where a page starts and how long it is. */
export type TrashPaging = { offset: number; limit: number };

/**
 * Collects one PAGE of trashed entries for a scope. For a clinic it is that clinic's
 * rows within its retention window; for the super admin it is every trashed row
 * across all clinics (no window), including trashed clinics themselves. `filters`
 * narrow the set (type / actor / date range / clinic / text search).
 *
 * WHY IT IS SHAPED LIKE THIS (delta D-07). This used to select EVERY soft-deleted row
 * of nine tables with no limit, merge them in memory, then filter and sort in
 * JavaScript. Under ADR-006 nothing is ever removed, so that set only grows — and the
 * super admin's view has no retention window at all, so it was every trashed row the
 * platform had ever produced, on one page.
 *
 * Every filter — including the free-text search — is now pushed into SQL, and each
 * source returns at most `offset + limit` rows. Merging ordered sources and slicing
 * is the standard way to page across several of them: to know the global page you do
 * need each source's first `offset + limit`, but that is bounded by the page you
 * asked for rather than by the size of the table.
 *
 * NOT a nine-branch SQL UNION, deliberately. That would page in one round trip, but
 * every label and detail expression (`Rs 400 · 12 Jan`, a leave's date range, a
 * visit's patient name) would have to be rewritten in SQL and kept in step with the
 * TypeScript that renders them — and modules cannot join a core union at all, since
 * core must never import a specialty table. The bound is what mattered; one query was
 * not worth trading the boundary and the readability for.
 */
async function collect(
  scope: Scope,
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
  paging: TrashPaging = { offset: 0, limit: 50 },
): Promise<TrashPage> {
  const wantType = (e: TrashEntity) => !filters.type || filters.type === e;
  // What each source must supply for the merge to be able to cut a correct page.
  const need = paging.offset + paging.limit;

  // Per-entity WHERE: directly-deleted rows, plus scope (clinic + retention window,
  // or the super admin's optional clinic filter) and the shared filters.
  //
  // The search used to run in JS over the assembled label/detail/deleter/clinic, so
  // it could not be pushed down. It matched deleter and clinic NAMES as well as the
  // row's own text — behaviour worth keeping — so those two are resolved to id sets
  // first (two small indexed lookups) and folded into each entity's WHERE alongside
  // an ILIKE on that entity's own searchable columns.
  const q = filters.q?.trim();
  const like = q ? `%${q}%` : null;
  const [actorMatches, clinicMatches] = like
    ? await Promise.all([
        db
          .select({ id: users.id })
          .from(users)
          .where(or(ilike(users.fullName, like), ilike(users.username, like)))
          .limit(500),
        db.select({ id: clinics.id }).from(clinics).where(ilike(clinics.name, like)).limit(500),
      ])
    : [[], []];
  const actorIdMatches = actorMatches.map((r) => r.id);
  const clinicIdMatches = clinicMatches.map((r) => r.id);

  const cond = (
    entity: TrashEntity,
    clinicCol: PgColumn,
    deletedCol: PgColumn,
    cascadeCol: PgColumn,
    byCol: PgColumn,
    /** This entity's own text columns, as the label/detail are built from them. */
    searchCols: PgColumn[] = [],
  ): SQL | undefined => {
    const parts: (SQL | undefined)[] = [isNotNull(deletedCol), eq(cascadeCol, false)];
    // A type-excluded entity contributes nothing, but the clinic scope below is still
    // appended — returning a bare `false` produced a query with no `clinic_id` in it,
    // which the tenant guard rightly flagged (ADR-018). The planner discards the whole
    // scan on the constant anyway, so this costs nothing.
    if (!wantType(entity)) parts.push(sql`false`);
    if (like) {
      const any: (SQL | undefined)[] = searchCols.map((c) => ilike(c, like));
      if (actorIdMatches.length) any.push(inArray(byCol, actorIdMatches));
      if (clinicIdMatches.length) any.push(inArray(clinicCol, clinicIdMatches));
      // No column can match → this entity contributes nothing for this search.
      parts.push(any.length ? or(...any) : sql`false`);
    }
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
      .where(cond("patient", patients.clinicId, patients.deletedAt, patients.deletedByCascade, patients.deletedBy, [patients.fullName]))
      .orderBy(desc(patients.deletedAt))
      .limit(need),
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
      .where(cond("appointment", appointments.clinicId, appointments.deletedAt, appointments.deletedByCascade, appointments.deletedBy, [patients.fullName]))
      .orderBy(desc(appointments.deletedAt))
      .limit(need),
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
      .where(cond("visit", visits.clinicId, visits.deletedAt, visits.deletedByCascade, visits.deletedBy, [patients.fullName]))
      .orderBy(desc(visits.deletedAt))
      .limit(need),
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
      .where(cond("recall", recalls.clinicId, recalls.deletedAt, recalls.deletedByCascade, recalls.deletedBy, [patients.fullName, recalls.reason]))
      .orderBy(desc(recalls.deletedAt))
      .limit(need),
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
      .where(cond("procedure", procedures.clinicId, procedures.deletedAt, procedures.deletedByCascade, procedures.deletedBy, [procedures.name]))
      .orderBy(desc(procedures.deletedAt))
      .limit(need),
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
      .where(cond("expense", expenses.clinicId, expenses.deletedAt, expenses.deletedByCascade, expenses.deletedBy, [expenses.vendor, expenses.note]))
      .orderBy(desc(expenses.deletedAt))
      .limit(need),
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
      .where(cond("leave", doctorLeaves.clinicId, doctorLeaves.deletedAt, doctorLeaves.deletedByCascade, doctorLeaves.deletedBy, [users.fullName, users.username]))
      .orderBy(desc(doctorLeaves.deletedAt))
      .limit(need),
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
      .where(cond("staff", users.clinicId, users.deletedAt, users.deletedByCascade, users.deletedBy, [users.fullName, users.username]))
      .orderBy(desc(users.deletedAt))
      .limit(need),
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
          .where(cond("clinic", clinics.id, clinics.deletedAt, clinics.deletedByCascade, clinics.deletedBy, [clinics.name]))
          .orderBy(desc(clinics.deletedAt))
          .limit(need)
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
    // ONE predicate, shared with the count — see `moduleRowMatches`. It also applies
    // the text search, which for core entities happens in SQL; a module's label is
    // built in JS from its own columns, so core can only match it here.
    if (!moduleRowMatches(filters, r)) continue;
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

  // Cut the page BEFORE resolving names. Each source gave us its first `need` rows,
  // so the merge holds at most `sources × need` — this is where it becomes `limit`,
  // and the two name lookups below then run over one page rather than everything.
  const ordered = items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  const page = ordered.slice(paging.offset, paging.offset + paging.limit);

  // Resolve deleter names (users may themselves be trashed — no notDeleted filter)
  // and clinic names (super-admin scope), in one query each.
  const actorIds = [...new Set(page.map((i) => i.deletedById).filter((x): x is string => Boolean(x)))];
  if (actorIds.length) {
    const actors = await db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(inArray(users.id, actorIds));
    const nameById = new Map(actors.map((a) => [a.id, a.fullName ?? a.username]));
    for (const it of page) it.deletedByName = it.deletedById ? nameById.get(it.deletedById) ?? null : null;
  }

  if (scope.kind === "all") {
    const clinicIds = [...new Set(page.map((i) => i.clinicId).filter((x): x is string => Boolean(x)))];
    if (clinicIds.length) {
      const rows = await db
        .select({ id: clinics.id, name: clinics.name })
        .from(clinics)
        .where(inArray(clinics.id, clinicIds));
      const byId = new Map(rows.map((c) => [c.id, c.name]));
      for (const it of page) it.clinicName = it.clinicId ? byId.get(it.clinicId) ?? null : null;
    }
  }

  // The search no longer runs here — it is part of every source's WHERE (see `cond`).
  // Filtering after the fact would have made pagination wrong: the page would be cut
  // first and then thinned, so pages would come back short and the total would lie.
  return { items: page, total: await countAll(scope, filters, cond, moduleRows) };
}

/**
 * How many entries match, across every source — what the pager needs to know.
 *
 * It reuses the very `cond` closure the page queries were built from, so the count
 * and the page can never disagree about what "matching" means. That is the whole
 * reason it takes the closure rather than rebuilding the predicates: two copies of a
 * filter drift exactly like two copies of a bill formula (ADR-015).
 */
async function countAll(
  scope: Scope,
  filters: TrashFilters,
  cond: (
    entity: TrashEntity,
    clinicCol: PgColumn,
    deletedCol: PgColumn,
    cascadeCol: PgColumn,
    byCol: PgColumn,
    searchCols?: PgColumn[],
  ) => SQL | undefined,
  moduleRows: ModuleTrashRow[],
): Promise<number> {
  const n = sql<number>`count(*)::int`;
  const counts = await Promise.all([
    db.select({ n }).from(patients).where(cond("patient", patients.clinicId, patients.deletedAt, patients.deletedByCascade, patients.deletedBy, [patients.fullName])),
    db.select({ n }).from(appointments).leftJoin(patients, eq(appointments.patientId, patients.id)).where(cond("appointment", appointments.clinicId, appointments.deletedAt, appointments.deletedByCascade, appointments.deletedBy, [patients.fullName])),
    db.select({ n }).from(visits).leftJoin(patients, eq(visits.patientId, patients.id)).where(cond("visit", visits.clinicId, visits.deletedAt, visits.deletedByCascade, visits.deletedBy, [patients.fullName])),
    db.select({ n }).from(recalls).leftJoin(patients, eq(recalls.patientId, patients.id)).where(cond("recall", recalls.clinicId, recalls.deletedAt, recalls.deletedByCascade, recalls.deletedBy, [patients.fullName, recalls.reason])),
    db.select({ n }).from(procedures).where(cond("procedure", procedures.clinicId, procedures.deletedAt, procedures.deletedByCascade, procedures.deletedBy, [procedures.name])),
    db.select({ n }).from(expenses).where(cond("expense", expenses.clinicId, expenses.deletedAt, expenses.deletedByCascade, expenses.deletedBy, [expenses.vendor, expenses.note])),
    db.select({ n }).from(doctorLeaves).leftJoin(users, eq(doctorLeaves.doctorId, users.id)).where(cond("leave", doctorLeaves.clinicId, doctorLeaves.deletedAt, doctorLeaves.deletedByCascade, doctorLeaves.deletedBy, [users.fullName, users.username])),
    db.select({ n }).from(users).where(cond("staff", users.clinicId, users.deletedAt, users.deletedByCascade, users.deletedBy, [users.fullName, users.username])),
    scope.kind === "all"
      ? db.select({ n }).from(clinics).where(cond("clinic", clinics.id, clinics.deletedAt, clinics.deletedByCascade, clinics.deletedBy, [clinics.name]))
      : Promise.resolve([{ n: 0 }]),
  ]);

  // Module rows are already an in-memory array (core cannot query a specialty table),
  // so they are counted the same way they are filtered — see the loop in `collect`.
  const moduleCount = countModuleRows(filters, moduleRows);
  return counts.reduce((sum, [row]) => sum + (row?.n ?? 0), 0) + moduleCount;
}

/** The module-row filter, expressed once so the page and the count agree. */
function moduleRowMatches(filters: TrashFilters, r: ModuleTrashRow): boolean {
  if (filters.type && filters.type !== "clinical_record") return false;
  if (filters.deletedBy && r.deletedById !== filters.deletedBy) return false;
  if (filters.from && r.deletedAt < filters.from) return false;
  if (filters.toExclusive && r.deletedAt >= filters.toExclusive) return false;
  if (filters.clinicId && r.clinicId !== filters.clinicId) return false;
  const q = filters.q?.trim().toLowerCase();
  if (q && ![r.label, r.detail].some((s) => s?.toLowerCase().includes(q))) return false;
  return true;
}

function countModuleRows(filters: TrashFilters, rows: ModuleTrashRow[]): number {
  return rows.reduce((n, r) => (moduleRowMatches(filters, r) ? n + 1 : n), 0);
}

/** A clinic admin's Trash: this clinic's entries within its retention window. */
export async function listClinicTrash(
  clinicId: string,
  retentionDays: number,
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
  paging?: TrashPaging,
): Promise<TrashPage> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return collect({ kind: "clinic", clinicId, cutoff }, filters, moduleRows, paging);
}

/**
 * The super admin's Trash: every trashed entry across all clinics, no window.
 *
 * Cross-tenant BY DEFINITION — this is the company's own view of everything that has
 * ever been deleted — so it says so with `unscoped` rather than quietly emitting
 * queries with no `clinic_id` for the tenant guard to flag (ADR-005 / ADR-018). It
 * had been doing exactly that; the guard's report only surfaced once a test drove
 * this path, which is the whole argument for keeping that output at zero.
 */
export async function listAllTrash(
  filters: TrashFilters = {},
  moduleRows: ModuleTrashRow[] = [],
  paging?: TrashPaging,
): Promise<TrashPage> {
  return unscoped("super admin lists trash across all clinics", () =>
    collect({ kind: "all" }, filters, moduleRows, paging),
  );
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
