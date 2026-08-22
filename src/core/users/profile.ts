import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";

/**
 * A signed-in user reading their OWN record — CORE per ADR-014.
 *
 * Every function here takes the user's id and returns only that user's row. There is
 * no "get any user" here on purpose: these back the self-service account pages, and a
 * lookup that could be handed someone else's id is one refactor away from being handed
 * one. Administering OTHER people's accounts is `core/admin/team`, which is
 * capability-gated; this is not.
 *
 * `users` is soft-deletable, so every read filters `notDeleted` — a trashed account
 * whose session had not yet expired would otherwise still render its own settings.
 */

/** The account-settings view of yourself: identity, avatar, and the one doctor flag. */
export async function getMyProfile(userId: string) {
  const [row] = await db
    .select({
      prefix: users.prefix,
      fullName: users.fullName,
      email: users.email,
      username: users.username,
      role: users.role,
      avatarKey: users.avatarKey,
      discountNeedsApproval: users.discountNeedsApproval,
    })
    .from(users)
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Just the avatar storage key — what `GET /api/me/avatar` needs to serve the file. */
export async function getMyAvatarKey(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)))
    .limit(1);
  return row?.avatarKey ?? null;
}

/** Your own 2FA state, for the security page: enabled, and how many backup codes remain. */
export async function getMyTotpState(
  userId: string,
): Promise<{ enabled: boolean; backupCount: number }> {
  const [row] = await db
    .select({ enabled: users.totpEnabled, backup: users.totpBackup })
    .from(users)
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)))
    .limit(1);
  return { enabled: row?.enabled ?? false, backupCount: row?.backup?.length ?? 0 };
}

/**
 * Self-service WRITES — a user changing their own record.
 *
 * Every one filters `id = userId`, so no caller can write to somebody else's row even
 * by mistake. That is the whole reason these live apart from `core/admin/team`, which
 * is capability-gated and edits OTHER people: same table, different authority, and a
 * function that could take either id is one refactor from taking the wrong one.
 */

/** Name, title and email — what the account form edits. */
export async function updateMyProfile(
  userId: string,
  input: { fullName: string; prefix: string | null; email: string | null },
): Promise<void> {
  await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** A doctor's own "my discounts need approval" switch. */
export async function setMyDiscountApproval(userId: string, needsApproval: boolean): Promise<void> {
  await db
    .update(users)
    .set({ discountNeedsApproval: needsApproval, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Sets a new password hash and clears the force-change flag.
 *
 * Takes the HASH, never a plaintext password: hashing belongs to `core/auth`, and a
 * query-layer function that accepted a raw password would be an invitation to store
 * one. The caller verifies the current password first.
 */
export async function setMyPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Points the avatar at a new file and returns the PREVIOUS key, so the caller can
 * delete the old file only after the new one is safely referenced. Returning it
 * rather than deleting here keeps storage out of the query layer — and an ordering
 * mistake would leave a user with no picture rather than a stale one.
 */
export async function setMyAvatarKey(
  userId: string,
  key: string | null,
): Promise<string | null> {
  const [prev] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  await db
    .update(users)
    .set({ avatarKey: key, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return prev?.avatarKey ?? null;
}

/**
 * Two-factor secrets and backup codes for the signed-in user.
 *
 * Self-service like the rest of this module — `id = userId` and nothing else — because
 * nobody may enable, disable or re-issue somebody else's second factor. What is stored
 * is the secret and HASHED backup codes; the plaintext codes are shown to the user
 * once by the caller and never persisted.
 */
export async function enableMyTotp(
  userId: string,
  secret: string,
  backupHashes: string[],
): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: true, totpBackup: backupHashes, updatedAt: new Date() })
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)));
}

export async function disableMyTotp(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: null, totpEnabled: false, totpBackup: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)));
}

export async function setMyBackupCodes(userId: string, backupHashes: string[]): Promise<void> {
  await db
    .update(users)
    .set({ totpBackup: backupHashes, updatedAt: new Date() })
    .where(and(eq(users.id, userId), notDeleted(users.deletedAt)));
}
