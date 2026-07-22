"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/core/auth/user";
import { canUseAccount } from "@/core/auth/admin-permissions";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { logActivity } from "@/core/audit/log";
import { STAFF_PREFIXES } from "@/core/types/auth";
import {
  saveUserFile,
  deleteFileByKey,
} from "@/core/integrations/storage";

export type AccountActionState = { error?: string; saved?: boolean };

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required.").max(120),
  prefix: z.enum(STAFF_PREFIXES).optional().catch(undefined),
  email: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** The signed-in user edits their OWN profile — name, title and email. */
export async function updateMyProfile(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireUser();
  if (!canUseAccount(user, "edit")) return { error: "You don't have access to change account settings." };

  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    prefix: formData.get("prefix") || undefined,
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        prefix: parsed.data.prefix ?? null,
        email: parsed.data.email ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  } catch (err) {
    const code =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === "23505") return { error: "That email is already in use." };
    throw err;
  }

  await logActivity({
    action: "update",
    entity: "settings",
    summary: "Updated their own profile",
  });
  revalidatePath("/account");
  return { saved: true };
}

/**
 * A DOCTOR toggles their OWN "discounts need approval" policy (choice B — editable
 * by both the doctor here and the clinic admin on the staff page). No-op for non-
 * doctors. When on, a discount that reduces this doctor's share waits for their OK.
 */
export async function updateMyDiscountApproval(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireUser();
  if (!canUseAccount(user, "edit")) return { error: "You don't have access to change account settings." };
  if (user.role !== "doctor") return { error: "Only doctors have this setting." };

  const needsApproval = formData.get("discountNeedsApproval") === "on";
  await db
    .update(users)
    .set({ discountNeedsApproval: needsApproval, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await logActivity({
    action: "update",
    entity: "settings",
    summary: needsApproval
      ? "Turned on approval for discounts off their share"
      : "Turned off approval for discounts off their share",
  });
  revalidatePath("/account");
  return { saved: true };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    password: z.string().min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

/** The signed-in user changes their OWN password (current password required). */
export async function changeMyPassword(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireUser();
  if (!canUseAccount(user, "edit")) return { error: "You don't have access to change account settings." };

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  if (!(await verifyCurrentUserPassword(parsed.data.currentPassword))) {
    return { error: "Your current password is incorrect." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await logActivity({
    action: "update",
    entity: "settings",
    summary: "Changed their own password",
  });
  return { saved: true };
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const AVATAR_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Upload/replace the signed-in user's profile picture. */
export async function uploadMyAvatar(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireUser();
  if (!canUseAccount(user, "edit")) return { error: "You don't have access to change account settings." };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  const ext = AVATAR_EXT[file.type];
  if (!ext) return { error: "Use a JPG, PNG or WebP image." };
  if (file.size > MAX_AVATAR_BYTES) return { error: "Image must be under 2 MB." };

  const data = Buffer.from(await file.arrayBuffer());
  const key = await saveUserFile(user.id, "avatar", data, ext);

  const [prev] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await db
    .update(users)
    .set({ avatarKey: key, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Remove the old file after the new one is saved.
  if (prev?.avatarKey && prev.avatarKey !== key) {
    await deleteFileByKey(prev.avatarKey);
  }

  await logActivity({
    action: "update",
    entity: "settings",
    summary: "Updated their profile picture",
  });
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { saved: true };
}

/** Remove the signed-in user's profile picture. */
export async function removeMyAvatar(): Promise<void> {
  const user = await requireUser();
  if (!canUseAccount(user, "edit")) return;
  const [prev] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  await db
    .update(users)
    .set({ avatarKey: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  if (prev?.avatarKey) await deleteFileByKey(prev.avatarKey);
  revalidatePath("/account");
  revalidatePath("/", "layout");
}
