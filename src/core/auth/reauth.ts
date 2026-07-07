import "server-only";

import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { verifyPassword } from "@/core/auth/password";
import { db } from "@/core/db";
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
    .where(eq(users.id, current.id))
    .limit(1);
  if (!row) return false;

  return verifyPassword(password, row.hash);
}
