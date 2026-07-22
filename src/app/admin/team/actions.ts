"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTeamManager } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import {
  ADMIN_CAPABILITY_IDS,
  ADMIN_SUBROLE_PRESETS,
  isOwner,
  sanitizeAdminCapabilities,
  type AssignableSubRole,
} from "@/core/auth/admin-permissions";
import type { CurrentUser } from "@/core/types/auth";
import { db } from "@/core/db";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { sessions, users } from "@/core/db/schema";
import { logActivity } from "@/core/audit/log";
import { USERNAME_REGEX } from "@/core/types/auth";

export type TeamActionState = { error?: string; saved?: boolean };

/** A sub-role stores its capability preset (super_admin = all slugs). */
function permsForSubRole(role: AssignableSubRole): string[] {
  return [...ADMIN_SUBROLE_PRESETS[role]];
}

/**
 * OWNER PROTECTION: the owner account may be managed ONLY by the owner. A
 * super_admin acting on a target must be blocked when the target is an owner and
 * the actor is not. Returns an error message, or null if allowed.
 */
async function ownerGuard(actor: CurrentUser, targetUserId: string): Promise<string | null> {
  if (isOwner(actor)) return null; // the owner may manage anyone
  const [t] = await db
    .select({ role: users.role, permissions: users.permissions })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (t && isOwner({ role: t.role, permissions: t.permissions })) {
    return "Only the owner can manage the owner account.";
  }
  return null;
}

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required.").max(120),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32)
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), { message: "Invalid username." }),
  password: z.string().min(8, "Password must be at least 8 characters."),
  subRole: z.enum(["super_admin", "support", "sales", "billing"]),
});

/** Creates another super-admin with a sub-role (owner-only). */
export async function createSuperAdminAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  await requireTeamManager();
  const parsed = createSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    password: formData.get("password"),
    subRole: formData.get("subRole") ?? "support",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await db.insert(users).values({
      clinicId: null,
      username: parsed.data.username,
      passwordHash,
      role: "super_admin",
      fullName: parsed.data.fullName,
      permissions: permsForSubRole(parsed.data.subRole),
      mustChangePassword: true,
    });
  } catch {
    return { error: "That username is already in use." };
  }

  await logActivity({
    action: "create",
    entity: "staff",
    clinicId: null,
    summary: `Added super-admin @${parsed.data.username} (${parsed.data.subRole})`,
  });
  revalidatePath("/admin/team");
  return { saved: true };
}

/** Suspends / reactivates a super-admin (owner-only). Can't suspend yourself. */
export async function setSuperAdminActiveAction(
  userId: string,
  isActive: boolean,
): Promise<TeamActionState> {
  const actor = await requireTeamManager();
  if (userId === actor.id) return { error: "You can't suspend your own account." };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, userId));
    if (!isActive) await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: isActive ? "Reactivated a super-admin" : "Suspended a super-admin",
  });
  revalidatePath("/admin/team");
  return { saved: true };
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required.").max(120),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32)
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), { message: "Invalid username." }),
});

/** Edits a team member's name + login username (owner-only). */
export async function editTeamMemberProfileAction(
  userId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireTeamManager();
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await db
      .update(users)
      .set({ fullName: parsed.data.fullName, username: parsed.data.username, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
  } catch {
    return { error: "That username is already in use." };
  }
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Edited team member profile (@${parsed.data.username})`,
  });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** Resets a team member's password to a temporary one (owner-only). Use /account
 *  for your OWN password (this would log you out). */
export async function resetTeamMemberPasswordAction(
  userId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireTeamManager();
  if (userId === actor.id) return { error: "Change your own password in Account settings." };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  await logActivity({ action: "update", entity: "staff", entityId: userId, summary: "Reset a team member's password" });
  return { saved: true };
}

/** Sets a team member's GRANULAR admin capabilities. Full set = super_admin
 *  (stored as the explicit slug list — NEVER NULL, which is reserved for the
 *  owner). The owner's access is immutable. You can't reduce your own access. */
export async function setSuperAdminCapabilitiesAction(
  userId: string,
  slugs: string[],
): Promise<TeamActionState> {
  const actor = await requireTeamManager();
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  // The owner account (NULL perms) always has full access — not editable here.
  const [target] = await db
    .select({ role: users.role, permissions: users.permissions })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (target && isOwner({ role: target.role, permissions: target.permissions })) {
    return { error: "The owner always has full access." };
  }

  const caps = sanitizeAdminCapabilities(slugs);
  const isFull = caps.length === ADMIN_CAPABILITY_IDS.length;
  if (userId === actor.id && !isFull) {
    return { error: "You can't reduce your own access." };
  }
  await db
    .update(users)
    .set({ permissions: caps, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Set team member capabilities (${isFull ? "super admin / all" : `${caps.length} caps`})`,
  });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** Deletes a super-admin (owner-only). SOFT delete + revoke sessions; frees the
 *  username. Can't delete yourself (guarantees at least one owner remains). */
export async function deleteSuperAdminAction(userId: string): Promise<TeamActionState> {
  const actor = await requireTeamManager();
  if (userId === actor.id) return { error: "You can't delete your own account." };
  const blocked = await ownerGuard(actor, userId);
  if (blocked) return { error: blocked };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set(softDeleteValues(actor.id, newDeleteGroup()))
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  await logActivity({
    action: "delete",
    entity: "staff",
    entityId: userId,
    summary: "Deleted a super-admin",
  });
  revalidatePath("/admin/team");
  return { saved: true };
}
