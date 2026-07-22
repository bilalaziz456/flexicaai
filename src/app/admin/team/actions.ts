"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminOwner } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import {
  ADMIN_SUBROLE_PRESETS,
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

/** Changes a super-admin's sub-role (owner-only). Can't demote the last owner. */
export async function setSuperAdminSubRoleAction(
  userId: string,
  subRole: AdminSubRole,
): Promise<TeamActionState> {
  const owner = await requireAdminOwner();
  if (userId === owner.id && subRole !== "owner") {
    return { error: "You can't remove your own owner access." };
  }
  await db
    .update(users)
    .set({ permissions: permsForSubRole(subRole), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Set super-admin sub-role → ${subRole}`,
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
