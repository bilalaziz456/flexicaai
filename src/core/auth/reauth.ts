import "server-only";

import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { verifyPassword } from "@/core/auth/password";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";

/**
 * Re-authentication — CORE. Confirms the SIGNED-IN user's own password before a
 * destructive action (delete). This is step-up auth: even a valid session must
 * re-prove the password to delete something, so a walked-away/borrowed session
 * can't wipe data. Callers show a friendly "Incorrect password." on false.
 */
export async function verifyCurrentUserPassword(
  password: string,
): Promise<boolean> {
  if (!password) return false;
  const current = await getCurrentUser();
  if (!current) return false;

  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, current.id), notDeleted(users.deletedAt)))
    .limit(1);
  if (!row) return false;

  return verifyPassword(password, row.hash);
}
