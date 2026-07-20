"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
} from "@/core/theme/theme";
import { createSession, destroySession } from "@/core/auth/session";
import { hashPassword, verifyPassword } from "@/core/auth/password";
import { loginByIp, loginByUser, retryAfterLabel } from "@/core/security/rate-limit";
import { requireUser } from "@/core/auth/user";
import { logActivityAs } from "@/core/audit/log";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { ROLE_HOME_ROUTE, type UserRole } from "@/core/types/auth";

/** Shared shape for useActionState in the login form. */
export type AuthActionState = { error?: string; message?: string };

const credentialsSchema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
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
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const username = parsed.data.username.toLowerCase();

  // Brute-force gate: throttle failed logins per-username (primary) and per-IP
  // (spraying). Checked BEFORE any DB work / hashing so a locked key costs nothing.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const userKey = `login:user:${username}`;
  const ipKey = `login:ip:${ip}`;
  const uGate = loginByUser.peek(userKey);
  const ipGate = loginByIp.peek(ipKey);
  if (uGate.blocked || ipGate.blocked) {
    const ms = Math.max(uGate.retryAfterMs, ipGate.retryAfterMs);
    return { error: `Too many attempts. Please try again in ${retryAfterLabel(ms)}.` };
  }
  // Count a failed attempt against both keys (used on every failure path below).
  const countFailure = () => {
    loginByUser.hit(userKey);
    loginByIp.hit(ipKey);
  };

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), notDeleted(users.deletedAt)))
    .limit(1);

  // Generic message for an unknown username OR a wrong password — never reveal
  // which, to avoid username enumeration.
  const invalid: AuthActionState = { error: "Incorrect username or password." };
  if (!user) {
    countFailure();
    return invalid;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    countFailure();
    return invalid;
  }
  // Correct credentials — clear the username's failure count (not a brute-force run).
  loginByUser.reset(userKey);

  // Only AFTER the password is verified do we reveal a suspended account. The
  // person has proven they own the credentials, so this leaks nothing an
  // attacker could enumerate — and it's clearer than "wrong password".
  if (!user.isActive) {
    return {
      error:
        "Your account has been suspended. Please contact your administrator.",
    };
  }

  await createSession(user.id);

  // Audit: record the sign-in (explicit actor — the session isn't readable yet
  // on this render).
  await logActivityAs(
    {
      clinicId: user.clinicId,
      userId: user.id,
      name: user.fullName ?? user.username,
      role: user.role,
    },
    { action: "login", entity: "session", summary: `${user.username} signed in` },
  );

  // Apply the account's saved theme on this browser (no flash on next render).
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, user.theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

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
