import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";

/**
 * The COMPANY's own team — super admins, not clinic staff — CORE per ADR-014.
 *
 * `viewerIsOwner` is a VISIBILITY rule, not a convenience: the owner account is the
 * one with NULL permissions, and a non-owner admin must never see it in the list.
 * That check has to travel with the query rather than being applied afterwards, or
 * the row is fetched and then hidden — which is a filter in the UI, not a boundary.
 *
 * Deleted accounts are excluded; suspended and deactivated ones are not, since
 * managing them is what the page is for.
 */
export async function listCompanyTeam(viewerIsOwner: boolean) {
  return db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      isActive: users.isActive,
      deactivatedAt: users.deactivatedAt,
      permissions: users.permissions,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "super_admin"),
        notDeleted(users.deletedAt),
        viewerIsOwner ? undefined : isNotNull(users.permissions),
      ),
    )
    .orderBy(asc(users.username));
}
