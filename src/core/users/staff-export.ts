import "server-only";

import { and, desc, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";

/**
 * One clinic's staff, shaped for the CSV export — CORE per ADR-014.
 *
 * The `q` search mirrors the staff LIST page deliberately: an export that quietly
 * returned a different set from the list the user was looking at is worse than no
 * export, because nothing on screen would say so.
 */
export async function listStaffForExport(clinicId: string, q = "") {
  const query = q.trim();
  const roleFilter = inArray(users.role, [...CLINIC_STAFF_ROLES]);
  const search = query
    ? or(ilike(users.fullName, `%${query}%`), ilike(users.username, `%${query}%`))
    : undefined;

  return db
    .select({
      username: users.username,
      prefix: users.prefix,
      fullName: users.fullName,
      role: users.role,
      email: users.email,
      isActive: users.isActive,
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        search ? and(roleFilter, search) : roleFilter,
      ),
    )
    .orderBy(desc(users.createdAt));
}
