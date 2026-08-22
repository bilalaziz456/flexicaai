import "server-only";

import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs, clinics } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { byClinic } from "@/core/db/tenant";
import { CLINIC_LOG_ROLES } from "@/core/audit/access";

/**
 * The super admin's activity-log page query — CORE per ADR-014, where it can be read
 * and reused instead of living in the page that renders it.
 *
 * Cross-tenant by design: this is the platform's internal audit trail, so it is
 * `unscoped` with the reason stated rather than tripping the guard (ADR-005/018).
 */
export type AdminLogFilters = {
  start: Date;
  endExclusive: Date;
  clinicId?: string;
  actorId?: string;
  action?: string;
};

export type AdminLogRow = {
  id: string;
  createdAt: Date;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string;
  clinicName: string | null;
};

export async function listAdminActivityLogs(
  filters: AdminLogFilters,
  paging: { offset: number; limit: number },
): Promise<{ rows: AdminLogRow[]; total: number }> {
  const conds = [
    gte(activityLogs.createdAt, filters.start),
    lt(activityLogs.createdAt, filters.endExclusive),
  ];
  if (filters.clinicId) conds.push(eq(activityLogs.clinicId, filters.clinicId));
  // The employee filter only applies within a chosen clinic (its option list is
  // clinic-scoped), so a stray actor with no clinic selected is ignored.
  if (filters.clinicId && filters.actorId) conds.push(eq(activityLogs.actorUserId, filters.actorId));
  if (filters.action) conds.push(eq(activityLogs.action, filters.action));
  const where = and(...conds);

  return unscoped("admin: activity logs across all clinics", async () => {
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: activityLogs.id,
          createdAt: activityLogs.createdAt,
          actorName: activityLogs.actorName,
          actorRole: activityLogs.actorRole,
          action: activityLogs.action,
          summary: activityLogs.summary,
          clinicName: clinics.name,
        })
        .from(activityLogs)
        .leftJoin(clinics, eq(activityLogs.clinicId, clinics.id))
        .where(where)
        .orderBy(desc(activityLogs.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      db.select({ total: count() }).from(activityLogs).where(where),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  });
}

/**
 * One clinic's OWN activity log — the clinic-admin view.
 *
 * Sibling of `listAdminActivityLogs`, and deliberately a separate function rather than
 * a flag on it: this one is `byClinic`-scoped and that one is `unscoped`. Collapsing
 * them into one with an optional clinicId would put a tenant boundary behind an
 * argument, which is exactly the shape that lets a caller forget it.
 *
 * The clinic sees only the ACTION categories the super admin granted
 * (`clinics.log_access`); the caller applies that filter, since it is a permission
 * decision rather than a query one.
 */
export type ClinicLogFilters = {
  start: Date;
  endExclusive: Date;
  /** The action categories the super admin granted this clinic. */
  allowedActions: string[];
  /** One granted action, when the user narrowed further. */
  action?: string;
  actorId?: string;
};

export async function listClinicActivityLogs(
  clinicId: string,
  filters: ClinicLogFilters,
  paging: { offset: number; limit: number },
): Promise<{ rows: Omit<AdminLogRow, "clinicName">[]; total: number }> {
  const conds = [
    // A specific granted action if filtered, otherwise every granted category.
    filters.action
      ? eq(activityLogs.action, filters.action)
      : inArray(activityLogs.action, filters.allowedActions),
    // Only the clinic's OWN staff — a super admin's actions against this clinic are
    // never shown to it, which is why the role filter is here and not optional.
    inArray(activityLogs.actorRole, [...CLINIC_LOG_ROLES]),
    gte(activityLogs.createdAt, filters.start),
    lt(activityLogs.createdAt, filters.endExclusive),
  ];
  if (filters.actorId) conds.push(eq(activityLogs.actorUserId, filters.actorId));
  const scoped = byClinic(activityLogs.clinicId, clinicId, and(...conds));
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: activityLogs.id,
        createdAt: activityLogs.createdAt,
        actorName: activityLogs.actorName,
        actorRole: activityLogs.actorRole,
        action: activityLogs.action,
        summary: activityLogs.summary,
      })
      .from(activityLogs)
      .where(scoped)
      .orderBy(desc(activityLogs.createdAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(activityLogs).where(scoped),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}
