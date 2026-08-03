"use server";

import { and, eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "@/core/auth/totp";
import { logActivity } from "@/core/audit/log";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";

/**
 * Super-admin 2FA (TOTP) enrolment — CORE. Only a super_admin manages their own
 * 2FA here; the secret is generated server-side, confirmed with a live code
 * before it's marked enabled, and backup codes are shown ONCE. See
 * docs/super-admin-plan.md §11 Feature 1.
 */

const ISSUER = "FlexicaAI";

export type BeginEnrollState = {
  error?: string;
  secret?: string;
  otpauth?: string;
};

/** Step 1: mint a fresh secret + otpauth URL to display (QR / manual entry).
 *  Nothing is persisted yet — the secret is only stored once a code confirms it. */
export async function beginTotpEnrollment(): Promise<BeginEnrollState> {
  const user = await requireRole("super_admin");
  const secret = generateTotpSecret();
  const otpauth = otpauthUrl({
    secret,
    label: user.email ?? user.username,
    issuer: ISSUER,
  });
  return { secret, otpauth };
}

export type ConfirmEnrollState = {
  error?: string;
  backupCodes?: string[];
};

/** Step 2: verify a live code against the pending secret, then persist secret +
 *  hashed backup codes and flip `totp_enabled`. Returns the plaintext backup
 *  codes ONCE for the user to save. */
export async function confirmTotpEnrollment(
  _prev: ConfirmEnrollState,
  formData: FormData,
): Promise<ConfirmEnrollState> {
  const user = await requireRole("super_admin");
  const secret = String(formData.get("secret") ?? "");
  const code = String(formData.get("code") ?? "");

  if (!secret) return { error: "Enrolment expired. Start again." };
  if (!verifyTotp(secret, code)) {
    return { error: "That code didn't match. Check your authenticator and try again." };
  }

  const { codes, hashes } = generateBackupCodes(10);
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: true, totpBackup: hashes, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), notDeleted(users.deletedAt)));

  await logActivity({
    action: "update",
    entity: "session",
    summary: `${user.username} enabled two-factor authentication`,
  });

  return { backupCodes: codes };
}

export type DisableState = { error?: string; message?: string };

/** Turn 2FA off. Step-up: the super-admin must re-enter their password. */
export async function disableTotp(
  _prev: DisableState,
  formData: FormData,
): Promise<DisableState> {
  const user = await requireRole("super_admin");
  const password = String(formData.get("password") ?? "");

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabled: false, totpBackup: null, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), notDeleted(users.deletedAt)));

  await logActivity({
    action: "update",
    entity: "session",
    summary: `${user.username} disabled two-factor authentication`,
  });

  return { message: "Two-factor authentication is now off." };
}

export type RegenState = { error?: string; backupCodes?: string[] };

/** Regenerate backup codes (invalidates the old set). Step-up with password. */
export async function regenerateBackupCodes(
  _prev: RegenState,
  formData: FormData,
): Promise<RegenState> {
  const user = await requireRole("super_admin");
  const password = String(formData.get("password") ?? "");

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }
  // Only meaningful while 2FA is on.
  const [row] = await db
    .select({ enabled: users.totpEnabled })
    .from(users)
    .where(and(eq(users.id, user.id), notDeleted(users.deletedAt)))
    .limit(1);
  if (!row?.enabled) return { error: "Enable two-factor authentication first." };

  const { codes, hashes } = generateBackupCodes(10);
  await db
    .update(users)
    .set({ totpBackup: hashes, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), notDeleted(users.deletedAt)));

  await logActivity({
    action: "update",
    entity: "session",
    summary: `${user.username} regenerated 2FA backup codes`,
  });

  return { backupCodes: codes };
}

// Re-exported so a future login/reauth path can consume a backup code without
// re-importing the whole module surface. (Kept here to co-locate 2FA writes.)
export { consumeBackupCode };
