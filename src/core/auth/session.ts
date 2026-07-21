import "server-only";

import { cache } from "react";
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
 * The full session context: the authenticated user PLUS the session's
 * `impersonated_clinic_id` (set only when a super-admin is viewing a clinic's
 * workspace — Feature 5). DEDUPED per request via `cache()`. Most callers want
 * `getSessionUser`; `getCurrentUser` uses this to detect impersonation.
 */
export const getSession = cache(
  async (): Promise<{ user: User; impersonatedClinicId: string | null } | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const [row] = await db
      .select({ user: users, impersonatedClinicId: sessions.impersonatedClinicId })
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
    return { user: row.user, impersonatedClinicId: row.impersonatedClinicId };
  },
);

/**
 * Resolves the current user from the session cookie, or null. Validates the
 * token against the DB and checks expiry + active flag. Safe to call from
 * Server Components (it only reads the cookie).
 *
 * DEDUPED per request via React `cache()`: a single render pass calls this many
 * times (layout + page + nested guards all hit requireWorkspace), and this collapses
 * them to ONE session⋈users lookup — a meaningful win at scale.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  return (await getSession())?.user ?? null;
});

/**
 * Sets (or clears) the CURRENT session's impersonated clinic — the super-admin
 * "view as clinic" toggle (Feature 5). Keyed by the cookie token so only this
 * session is affected. Call from a Server Action.
 */
export async function setSessionImpersonation(
  clinicId: string | null,
): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return;
  await db
    .update(sessions)
    .set({ impersonatedClinicId: clinicId })
    .where(eq(sessions.tokenHash, hashToken(token)));
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
