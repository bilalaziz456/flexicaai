import "server-only";

import { createHash, randomBytes } from "crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { passwordResetTokens, sessions, users } from "@/core/db/schema";
import { hashPassword } from "@/core/auth/password";
import { sendEmail } from "@/core/notifications/email";
import { passwordResetEmail } from "@/core/notifications/email-templates";
import { serverEnv } from "@/core/lib/env";

/**
 * Self-service password reset — CORE. Opaque tokens (32 random bytes) stored only as
 * their SHA-256 (like sessions), single-use, short-lived. The request path is
 * enumeration-safe (never reveals whether an account exists); consuming a token also
 * revokes the user's sessions. Rate limiting lives at the action layer.
 */

const TTL_MINUTES = 60;
const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** A live user matched by username OR email (case-insensitive). Identity table → not
 *  clinic-scoped (a user resets by their own credential, across clinics). */
async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(notDeleted(users.deletedAt), or(eq(users.username, id), eq(sql`lower(${users.email})`, id))))
    .limit(1);
  return u ?? null;
}

/**
 * Start a reset: if the identifier maps to an ACTIVE user WITH an email on file, mint a
 * token and email the link. Returns NOTHING useful to the caller either way — the
 * forgot-password action shows the same generic message regardless (no enumeration).
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const user = await findUserByIdentifier(identifier);
  if (!user || !user.isActive || !user.email) return;

  const raw = randomBytes(32).toString("hex");
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
  });

  const link = `${serverEnv.APP_URL}/reset-password?token=${raw}`;
  const mail = passwordResetEmail({ name: user.fullName ?? user.username, link, expiresMins: TTL_MINUTES });
  await sendEmail({ to: user.email, ...mail });
}

/** True (with the user id) if the token is unused and unexpired; else null. */
export async function validateResetToken(raw: string): Promise<{ userId: string } | null> {
  if (!raw) return null;
  const [row] = await db
    .select({
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(raw)))
    .limit(1);
  if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
  return { userId: row.userId };
}

/**
 * Consume a token and set the new password — atomic. Re-checks validity under lock,
 * sets the bcrypt hash, marks the token (and the user's other unused tokens) used,
 * clears `must_change_password`, and REVOKES all the user's sessions.
 */
export async function consumeResetToken(
  raw: string,
  newPassword: string,
): Promise<{ ok: true } | { error: string }> {
  if (!raw || newPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  const tokenHash = hashToken(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      return { error: "This reset link is invalid or has expired. Request a new one." };
    }

    const passwordHash = await hashPassword(newPassword);
    await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, row.userId));
    // Burn every outstanding token for this user (including the one just used).
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
    // A reset implies possible compromise → drop all sessions; they must log in fresh.
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    return { ok: true };
  });
}
