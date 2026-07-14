import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/core/db";
import { sessions, users, type User } from "@/core/db/schema";
import { isProduction } from "@/core/lib/env";
import { SESSION_COOKIE_NAME } from "@/core/auth/constants";

export { SESSION_COOKIE_NAME };
const SESSION_TTL_DAYS = 7;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** We store only the hash of the token, so a DB leak can't be replayed. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a session for a user and sets the cookie. Call from Server Actions /
 * Route Handlers only (Server Components cannot write cookies).
 *
 * DRIZZLE: a single typed insert — exactly what the query builder is for.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolves the current user from the session cookie, or null. Validates the
 * token against the DB and checks expiry + active flag. Safe to call from
 * Server Components (it only reads the cookie).
 *
 * DRIZZLE: a simple, type-safe join run once per request — the query builder is
 * ideal here; there is nothing to hand-tune.
 */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  // A suspended (inactive) OR soft-deleted (trashed) user has no valid session.
  // Their sessions are hard-revoked on suspend/delete; this is defense-in-depth.
  if (!row || !row.user.isActive || row.user.deletedAt) return null;
  return row.user;
}

/**
 * Destroys the current session (DB row + cookie). Call from a Server Action.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
