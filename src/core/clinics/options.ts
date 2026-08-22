import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, users } from "@/core/db/schema";
import type { UserRole } from "@/core/types/auth";
import { notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";

/**
 * Every live clinic as `{ id, name }` — the option list behind the super admin's
 * "Clinic" filter (logs, trash, invoices, announcements), CORE per ADR-014.
 *
 * Four pages had written this same four-line query inline. None of them was wrong,
 * which is the point: the cost of a query at a call site is not that it breaks, it is
 * that there is no single place to change it and nothing stops the fifth copy.
 *
 * Cross-tenant by definition — it is the super admin choosing WHICH tenant to look at
 * — so it says `unscoped` rather than leaving the guard to flag it (ADR-005/018).
 */
export type ClinicOption = { id: string; name: string };

/**
 * `includeDeleted` is NOT a convenience — the two historical views need it. A trashed
 * clinic still has activity logs and still has trash, so dropping it from those
 * pickers would hide records that exist. The live-only default is what every
 * forward-looking picker (announcements, invoicing) wants.
 */
export async function listClinicOptions(
  opts: { includeDeleted?: boolean } = {},
): Promise<ClinicOption[]> {
  return unscoped("super admin picks a clinic to filter by", () =>
    db
      .select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .where(opts.includeDeleted ? undefined : notDeleted(clinics.deletedAt))
      .orderBy(asc(clinics.name)),
  );
}

/** The same list plus each clinic's subscription price — the invoice picker needs it. */
// Return type inferred from the select, deliberately: hand-writing it here re-stated
// `monthlyPrice`'s nullability and got it wrong (conventions.md §1 — derive, don't restate).
export async function listClinicOptionsWithPrice() {
  return unscoped("super admin picks a clinic to invoice", () =>
    db
      .select({ id: clinics.id, name: clinics.name, monthlyPrice: clinics.monthlyPrice })
      .from(clinics)
      .where(notDeleted(clinics.deletedAt))
      .orderBy(asc(clinics.name)),
  );
}

/**
 * One clinic's staff as actor options — the "Employee" filter on the super admin's
 * activity-log and Trash pages.
 *
 * Reads `users` rather than the logs/trash themselves, so somebody appears in the
 * filter before they have generated a row.
 *
 * `liveOnly` exists because the two callers genuinely disagreed and this refactor is
 * not the place to settle it: the activity log includes trashed staff (their actions
 * are still in the record), while Trash excluded them. Both behaviours are preserved
 * verbatim rather than quietly unified — a refactor that changes what a filter
 * returns is a bug wearing a tidy diff.
 */
export async function listClinicActorOptions(
  clinicId: string,
  opts: { roles?: readonly UserRole[]; liveOnly?: boolean } = {},
): Promise<{ id: string; name: string }[]> {
  const conds = [eq(users.clinicId, clinicId)];
  if (opts.roles?.length) conds.push(inArray(users.role, [...opts.roles] as UserRole[]));
  if (opts.liveOnly) conds.push(notDeleted(users.deletedAt)!);

  const rows = await unscoped("super admin picks an employee to filter by", () =>
    db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(and(...conds))
      .orderBy(asc(users.fullName)),
  );
  return rows.map((r) => ({ id: r.id, name: r.fullName ?? r.username }));
}

/**
 * The super admin's clinics list — one page, with each clinic's account manager
 * resolved. CORE per ADR-014.
 *
 * The `assignedTo` join filters `deleted_at IS NULL` on the USER, not the clinic: a
 * clinic whose manager was deleted still belongs in the list, it just has nobody
 * assigned. An inner join here would make clinics vanish from the company's own view
 * because of something that happened to a staff account.
 *
 * `assigneeActive === false` is surfaced separately from "no manager": a suspended
 * manager is a clinic that LOOKS covered and is not, which is exactly what the list
 * needs to show.
 */
export async function listClinicsPage(
  where: SQL | undefined,
  paging: { offset: number; limit: number },
) {
  return unscoped("super admin lists every clinic", async () => {
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          clinic: clinics,
          assigneeName: users.fullName,
          assigneeUsername: users.username,
          assigneeActive: users.isActive,
        })
        .from(clinics)
        .leftJoin(users, and(eq(clinics.assignedTo, users.id), isNull(users.deletedAt)))
        .where(where)
        .orderBy(desc(clinics.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      db.select({ total: count() }).from(clinics).where(where),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  });
}

/** What the super admin's clinic list can be narrowed by. */
export type ClinicListFilters = {
  /** Name search. */
  q?: string;
  status?: string;
  /**
   * Restricts to one account manager. `null` means UNASSIGNED specifically — distinct
   * from `undefined`, which means "don't filter by manager at all".
   */
  assignedTo?: string | null;
  /**
   * The billing filter is resolved to ids by the caller, because billing health is
   * COMPUTED (paid-through dates, grace periods) rather than a column. An empty array
   * means "the filter was set and nothing matched" and must yield no rows — not, as a
   * missing filter would, every row.
   */
  billingIds?: string[];
};

/** Builds the list's WHERE, including the always-on "not trashed" rule. */
export function clinicListWhere(filters: ClinicListFilters): SQL | undefined {
  return and(
    // Trashed clinics live in the admin Trash, never in this list.
    notDeleted(clinics.deletedAt),
    filters.q ? ilike(clinics.name, `%${filters.q}%`) : undefined,
    filters.status ? eq(clinics.status, filters.status) : undefined,
    filters.assignedTo === null
      ? isNull(clinics.assignedTo)
      : filters.assignedTo
        ? eq(clinics.assignedTo, filters.assignedTo)
        : undefined,
    filters.billingIds
      ? filters.billingIds.length
        ? inArray(clinics.id, filters.billingIds)
        : sql`false`
      : undefined,
  );
}
