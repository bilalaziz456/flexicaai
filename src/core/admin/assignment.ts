import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";

/**
 * Clinic → team-member assignment (account manager). CORE. The assignable pool is
 * the company team (super-admin accounts). See docs/super-admin-plan.md.
 */

export type TeamMemberOption = {
  id: string;
  name: string;
  /**
   * Whether this member can actually be given to a clinic as a contact — they have a
   * phone or an email. Carried on the OPTION so the assign screen can warn at the
   * moment of assigning, rather than letting somebody pick a manager whose assignment
   * quietly does nothing on the clinic side (see `getAccountManagerContact`).
   */
  reachable: boolean;
};

/** The assignable team (super-admins), for the clinic "assigned to" picker. Includes
 *  SUSPENDED members (marked) so an existing suspended assignee still displays and
 *  the owner sees who's inactive; only DELETED members are dropped. */
export async function listAssignableTeam(): Promise<TeamMemberOption[]> {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      isActive: users.isActive,
      phone: users.phone,
      email: users.email,
    })
    .from(users)
    // Active + suspended (suspended keep their clinics, so must still show); exclude
    // DEACTIVATED (no clinics) + deleted.
    .where(and(eq(users.role, "super_admin"), notDeleted(users.deletedAt), isNull(users.deactivatedAt)))
    .orderBy(users.username);
  return rows.map((r) => ({
    id: r.id,
    name: (r.fullName ?? r.username) + (r.isActive ? "" : " (suspended)"),
    reachable: Boolean(r.phone || r.email),
  }));
}

/** ACTIVE team members only — the valid targets to reassign clinics TO. */
export async function listActiveTeam(): Promise<TeamMemberOption[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, username: users.username, phone: users.phone, email: users.email })
    .from(users)
    .where(and(eq(users.role, "super_admin"), notDeleted(users.deletedAt), eq(users.isActive, true)))
    .orderBy(users.username);
  return rows.map((r) => ({
    id: r.id,
    name: r.fullName ?? r.username,
    reachable: Boolean(r.phone || r.email),
  }));
}
