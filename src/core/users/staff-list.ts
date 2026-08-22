import "server-only";

import { and, count, desc, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

/**
 * The clinic's staff list — CORE per ADR-014, shared by the list page and the CSV
 * export, which had the same search and the same role filter written inline in both.
 * An export that returns a different set from the list on screen is a bug nothing
 * visible would report, so the two now come from one place.
 */

/** Clinic staff roles only, narrowed by an optional name/username search. */
export function staffSearchWhere(clinicId: string, q = ""): SQL | undefined {
  const query = q.trim();
  const roleFilter = inArray(users.role, [...CLINIC_STAFF_ROLES]);
  const search = query
    ? or(ilike(users.fullName, `%${query}%`), ilike(users.username, `%${query}%`))
    : undefined;
  return byClinic(
    users.clinicId,
    clinicId,
    notDeleted(users.deletedAt),
    search ? and(roleFilter, search) : roleFilter,
  );
}

const STAFF_COLUMNS = {
  id: users.id,
  username: users.username,
  prefix: users.prefix,
  fullName: users.fullName,
  role: users.role,
  email: users.email,
  isActive: users.isActive,
  availability: users.availability,
  dailyLimit: users.dailyAppointmentLimit,
  fee: users.consultationFee,
} as const;

/** One page of staff, newest first, plus the total the pager needs. */
export async function listClinicStaff(
  clinicId: string,
  q: string,
  paging: { offset: number; limit: number },
) {
  const where = staffSearchWhere(clinicId, q);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(STAFF_COLUMNS)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}

/** Every matching staff member, for the CSV — unbounded on purpose, like the list. */
export async function listStaffForExport(clinicId: string, q = "") {
  return db
    .select(STAFF_COLUMNS)
    .from(users)
    .where(staffSearchWhere(clinicId, q))
    .orderBy(desc(users.createdAt));
}
