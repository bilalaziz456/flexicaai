import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  doctorLeaves,
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
  | "patient"
  | "appointment"
  | "visit"
  | "recall"
  | "procedure"
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
 * Collects the trashed ENTRIES for a scope. For a clinic it is that clinic's rows
 * within its retention window; for the super admin it is every trashed row across
 * all clinics (no window), including trashed clinics themselves.
 */
async function collect(scope: Scope): Promise<TrashItem[]> {
  const clinicWindow = (clinicCol: PgColumn, deletedCol: PgColumn): SQL | undefined =>
    scope.kind === "clinic"
      ? and(eq(clinicCol, scope.clinicId), gte(deletedCol, scope.cutoff))
      : undefined;

  const base = (cascadeCol: PgColumn, deletedCol: PgColumn): SQL | undefined =>
    and(isNotNull(deletedCol), eq(cascadeCol, false));

  // Each entity is queried separately (label/detail differ). All filter to
  // directly-deleted rows; the clinic scope also filters clinic + retention window.
  const [pats, appts, vis, recs, procs, leaves, staff, clins] = await Promise.all([
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
      .where(and(base(patients.deletedByCascade, patients.deletedAt), clinicWindow(patients.clinicId, patients.deletedAt)))
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
      .where(and(base(appointments.deletedByCascade, appointments.deletedAt), clinicWindow(appointments.clinicId, appointments.deletedAt)))
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
      .where(and(base(visits.deletedByCascade, visits.deletedAt), clinicWindow(visits.clinicId, visits.deletedAt)))
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
      .where(and(base(recalls.deletedByCascade, recalls.deletedAt), clinicWindow(recalls.clinicId, recalls.deletedAt)))
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
      .where(and(base(procedures.deletedByCascade, procedures.deletedAt), clinicWindow(procedures.clinicId, procedures.deletedAt)))
      .orderBy(desc(procedures.deletedAt)),
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
      .where(and(base(doctorLeaves.deletedByCascade, doctorLeaves.deletedAt), clinicWindow(doctorLeaves.clinicId, doctorLeaves.deletedAt)))
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
      .where(and(base(users.deletedByCascade, users.deletedAt), clinicWindow(users.clinicId, users.deletedAt)))
      .orderBy(desc(users.deletedAt)),
    // Clinics only appear in the super-admin (all) scope.
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
          .where(base(clinics.deletedByCascade, clinics.deletedAt))
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
    push({ entity: "visit", id: r.id, group: r.group ?? r.id, label: r.patientName ? `${r.patientName} — clinical note` : "Clinical note", detail: dateStr(r.visitDate), clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of recs)
    push({ entity: "recall", id: r.id, group: r.group ?? r.id, label: r.patientName ? `${r.patientName} — recall` : (r.reason ?? "Recall"), detail: r.reason, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of procs)
    push({ entity: "procedure", id: r.id, group: r.group ?? r.id, label: r.name, detail: `Rs ${r.price}`, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of leaves)
    push({ entity: "leave", id: r.id, group: r.group ?? r.id, label: `${r.doctorName ?? r.doctorUsername ?? "Doctor"} — leave`, detail: r.startDate === r.endDate ? dateStr(r.startDate) : `${dateStr(r.startDate)} – ${dateStr(r.endDate)}`, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of staff)
    push({ entity: "staff", id: r.id, group: r.group ?? r.id, label: r.fullName ?? r.username, detail: r.role, clinicId: r.clinicId, deletedAt: r.deletedAt!, deletedById: r.deletedBy });
  for (const r of clins)
    push({ entity: "clinic", id: r.id, group: r.group ?? r.id, label: r.name, detail: "Whole clinic + all its data", clinicId: r.id, deletedAt: r.deletedAt!, deletedById: r.deletedBy });

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

  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** A clinic admin's Trash: this clinic's entries within its retention window. */
export async function listClinicTrash(
  clinicId: string,
  retentionDays: number,
): Promise<TrashItem[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return collect({ kind: "clinic", clinicId, cutoff });
}

/** The super admin's Trash: every trashed entry across all clinics, no window. */
export async function listAllTrash(): Promise<TrashItem[]> {
  return collect({ kind: "all" });
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
export async function restoreForClinic(clinicId: string, group: string): Promise<void> {
  await revertGroup(group, clinicId);
}

/** Super-admin restore of a group (any clinic, and the clinic row itself). */
export async function restoreGlobal(group: string): Promise<void> {
  await revertGroup(group, null);
}

// ---- Purge (super-admin legal erasure only) -------------------------------

/**
 * PHYSICALLY deletes every row in a delete group — the ONLY hard delete in the
 * app, reserved for a legal erasure request and gated to the super admin at the
 * action layer. FK cascades remove dependent rows (appointment procedures, sales,
 * a clinic's whole tree), so we delete leaf→root and let the DB do the rest.
 */
export async function purgeGroup(group: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Void sales for the group's appointments first (sales has no group column).
    const appts = await tx.select({ id: appointments.id, clinicId: appointments.clinicId }).from(appointments).where(eq(appointments.deleteGroup, group));
    for (const a of appts) await voidSaleForAppointment(a.clinicId, a.id);

    await tx.delete(visits).where(eq(visits.deleteGroup, group));
    await tx.delete(recalls).where(eq(recalls.deleteGroup, group));
    await tx.delete(appointments).where(eq(appointments.deleteGroup, group));
    await tx.delete(doctorLeaves).where(eq(doctorLeaves.deleteGroup, group));
    await tx.delete(procedures).where(eq(procedures.deleteGroup, group));
    await tx.delete(patients).where(eq(patients.deleteGroup, group));
    await tx.delete(users).where(eq(users.deleteGroup, group));
    // Deleting the clinic cascades anything left under it.
    await tx.delete(clinics).where(eq(clinics.deleteGroup, group));
  });
}
