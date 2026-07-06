"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createSession, destroySession } from "@/core/auth/session";
import { hashPassword, verifyPassword } from "@/core/auth/password";
import { requireUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { ROLE_HOME_ROUTE, type UserRole } from "@/core/types/auth";

/** Shared shape for useActionState in the login form. */
export type AuthActionState = { error?: string; message?: string };

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * Signs a user in with email + password, then routes them to the panel their
 * role owns. CORE: routing is by role only, never by specialty/module.
 *
 * DRIZZLE: a single indexed lookup by email — the query builder's sweet spot.
 */
export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const email = parsed.data.email.toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same generic message whether the email is unknown, the password is wrong,
  // or the account is disabled — never reveal which.
  const invalid: AuthActionState = { error: "Incorrect email or password." };
  if (!user || !user.isActive) return invalid;

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return invalid;

  await createSession(user.id);
  if (user.mustChangePassword) redirect("/change-password");
  redirect(ROLE_HOME_ROUTE[user.role as UserRole]);
}

const changePasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Sets the signed-in user's own password and clears the must-change flag. Used
 * for the forced first-login change; also usable as a normal "change password".
 */
export async function changePassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  redirect(ROLE_HOME_ROUTE[user.role]);
}

/**
 * NOTE: There is intentionally no public signup. Accounts are provisioned only
 * from inside the app — a Super Admin creates clinics + clinic admins (Step 5),
 * and a clinic admin creates their own staff (Step 6). No account = no login.
 * The very first Super Admin is created by `npm run db:seed`.
 */

/** Signs the user out and returns to the login page. */
export async function signOut() {
  await destroySession();
  redirect("/login");
}
