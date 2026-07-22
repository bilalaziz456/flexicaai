"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminOwner } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import {
  ADMIN_CAPABILITY_IDS,
  ADMIN_SUBROLE_PRESETS,
  sanitizeAdminCapabilities,
  type AdminSubRole,
} from "@/core/auth/admin-permissions";
import { db } from "@/core/db";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { sessions, users } from "@/core/db/schema";
import { logActivity } from "@/core/audit/log";
import { USERNAME_REGEX } from "@/core/types/auth";

export type TeamActionState = { error?: string; saved?: boolean };

/** owner stores NULL permissions (= all); a sub-role stores its capability preset. */
function permsForSubRole(role: AdminSubRole): string[] | null {
  return role === "owner" ? null : [...ADMIN_SUBROLE_PRESETS[role]];
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
  subRole: z.enum(["owner", "support", "sales", "billing"]),
});

/** Creates another super-admin with a sub-role (owner-only). */
export async function createSuperAdminAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  await requireAdminOwner();
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
  const owner = await requireAdminOwner();
  if (userId === owner.id) return { error: "You can't suspend your own account." };

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
  await requireAdminOwner();
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
  const owner = await requireAdminOwner();
  if (userId === owner.id) return { error: "Change your own password in Account settings." };

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

/** Sets a team member's GRANULAR admin capabilities (owner-only). Storing exactly
 *  the full set = owner (stored as NULL). You can't reduce your own access. */
export async function setSuperAdminCapabilitiesAction(
  userId: string,
  slugs: string[],
): Promise<TeamActionState> {
  const owner = await requireAdminOwner();
  const caps = sanitizeAdminCapabilities(slugs);
  const isFull = caps.length === ADMIN_CAPABILITY_IDS.length;
  if (userId === owner.id && !isFull) {
    return { error: "You can't reduce your own access." };
  }
  await db
    .update(users)
    .set({ permissions: isFull ? null : caps, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.role, "super_admin")));
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Set team member capabilities (${isFull ? "owner / all" : `${caps.length} caps`})`,
  });
  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${userId}`);
  return { saved: true };
}

/** Deletes a super-admin (owner-only). SOFT delete + revoke sessions; frees the
 *  username. Can't delete yourself (guarantees at least one owner remains). */
export async function deleteSuperAdminAction(userId: string): Promise<TeamActionState> {
  const owner = await requireAdminOwner();
  if (userId === owner.id) return { error: "You can't delete your own account." };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set(softDeleteValues(owner.id, newDeleteGroup()))
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
