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
