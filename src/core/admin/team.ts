import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, sessions, users } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";

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

/**
 * Team WRITES — the company managing its own super admins.
 *
 * Every one is narrowed to `role = 'super_admin'` as well as the id. That is not
 * belt-and-braces: these functions take a userId from a form, and without the role
 * clause a mistyped or tampered id could reach a CLINIC's staff account and reset its
 * password or rewrite its permissions from the company panel. The caller still does
 * the owner guard and the no-escalation checks — those need the ACTOR, which is auth's
 * business, not the query layer's.
 */

/** Role + permissions for the owner guard (NULL permissions = the owner). */
export async function getTeamMemberIdentity(userId: string) {
  const [row] = await db
    .select({ role: users.role, permissions: users.permissions })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function createSuperAdmin(input: {
  username: string;
  passwordHash: string;
  fullName: string;
  permissions: string[];
}): Promise<void> {
  await db.insert(users).values({
    clinicId: null,
    role: "super_admin",
    mustChangePassword: true,
    ...input,
  });
}

/**
 * SUSPEND — block login and revoke sessions, but keep their clinic assignments.
 *
 * One transaction: a user marked inactive whose sessions survived is still signed in,
 * which is not "suspended" in any sense the word is used here.
 */
export async function suspendTeamMember(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: false, deactivatedAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

/**
 * DEACTIVATE — suspend, and additionally unassign every clinic they managed.
 *
 * The unassignment joins the same transaction because a deactivated account left as
 * the account manager on live clinics means those clinics have nobody watching them
 * while appearing covered.
 */
export async function deactivateTeamMember(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx
      .update(clinics)
      .set({ assignedTo: null, updatedAt: new Date() })
      .where(eq(clinics.assignedTo, userId));
  });
}

/** REACTIVATE — restore login. Clinics stay wherever they are now. */
export async function reactivateTeamMember(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ isActive: true, deactivatedAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function updateTeamMemberProfile(
  userId: string,
  input: { fullName: string; username: string },
): Promise<void> {
  await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
}

/**
 * Sets a new password and forces a change on next sign-in, revoking existing sessions
 * in the same transaction — an admin whose password was reset must not stay signed in
 * on the old one.
 */
export async function resetTeamMemberPassword(userId: string, passwordHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

/** Stores the explicit capability slug list. NEVER null — that is reserved for the owner. */
export async function setTeamMemberCapabilities(userId: string, caps: string[]): Promise<void> {
  await db
    .update(users)
    .set({ permissions: caps, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
}

/** An ACTIVE super admin, for validating a reassignment target. */
export async function findActiveTeamMember(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.role, "super_admin"),
        notDeleted(users.deletedAt),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Moves every clinic assigned to one member onto another (or nobody). */
export async function reassignClinics(
  fromUserId: string,
  toUserId: string | null,
): Promise<number> {
  const rows = await db
    .update(clinics)
    .set({ assignedTo: toUserId, updatedAt: new Date() })
    .where(eq(clinics.assignedTo, fromUserId))
    .returning({ id: clinics.id });
  return rows.length;
}

/**
 * Soft-deletes a team member, revokes their sessions and unassigns their clinics — all
 * in one transaction.
 *
 * The unassignment is explicit BECAUSE the delete is soft: the row survives, so the
 * FK's `ON DELETE SET NULL` never fires and a deleted member would otherwise stay
 * listed as the account manager on live clinics.
 */
export async function softDeleteTeamMember(userId: string, actorId: string): Promise<void> {
  // The delete group is minted HERE rather than passed in: it exists to tie a parent
  // and the rows its deletion hid into one restorable batch, which is this function's
  // business, not the caller's.
  const deleteGroup = newDeleteGroup();
  await db.transaction(async (tx) => {
    await tx.update(users).set(softDeleteValues(actorId, deleteGroup)).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx
      .update(clinics)
      .set({ assignedTo: null, updatedAt: new Date() })
      .where(eq(clinics.assignedTo, userId));
  });
}
