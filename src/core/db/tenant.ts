import "server-only";

import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Tenant isolation helper. EVERY query against a tenant table must be scoped by
 * clinic_id — this is the multi-tenancy boundary now that we don't use RLS
 * (CLAUDE.md §5/§10). Using this helper makes that intent explicit and greppable.
 *
 * Usage:
 *   await db.select().from(patients).where(byClinic(patients.clinicId, clinicId));
 *
 *   // combine with more conditions:
 *   await db.select().from(visits)
 *     .where(byClinic(visits.clinicId, clinicId, eq(visits.status, "approved")));
 *
 * Rule of thumb: if a table has a clinic_id, no read/update/delete should run
 * without byClinic() in its WHERE. Super Admin (cross-tenant) queries are the
 * only exception and must be explicit and obvious at the call site.
 */
export function byClinic(
  clinicIdColumn: PgColumn,
  clinicId: string,
  ...extra: (SQL | undefined)[]
): SQL {
  const scope = eq(clinicIdColumn, clinicId);
  const conditions = extra.filter((c): c is SQL => c !== undefined);
  return conditions.length ? (and(scope, ...conditions) as SQL) : scope;
}
