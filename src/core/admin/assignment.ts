import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";

/**
 * Clinic → team-member assignment (account manager). CORE. The assignable pool is
 * the company team (super-admin accounts). See docs/super-admin-plan.md.
 */

export type TeamMemberOption = { id: string; name: string };

/** The assignable team (super-admins), for the clinic "assigned to" picker. Includes
 *  SUSPENDED members (marked) so an existing suspended assignee still displays and
 *  the owner sees who's inactive; only DELETED members are dropped. */
export async function listAssignableTeam(): Promise<TeamMemberOption[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, username: users.username, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.role, "super_admin"), notDeleted(users.deletedAt)))
    .orderBy(users.username);
  return rows.map((r) => ({
    id: r.id,
    name: (r.fullName ?? r.username) + (r.isActive ? "" : " (suspended)"),
  }));
}
