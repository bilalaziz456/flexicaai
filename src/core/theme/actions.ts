"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import {
  isThemePreference,
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
} from "@/core/theme/theme";

/**
 * Persists the signed-in user's theme preference to their account (durable,
 * follows them across devices) and mirrors it to the cookie. The client also
 * applies it immediately, so this is effectively fire-and-forget.
 */
export async function setThemePreference(theme: string): Promise<void> {
  if (!isThemePreference(theme)) return;

  const user = await requireUser();

  await db
    .update(users)
    .set({ theme, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const store = await cookies();
  store.set(THEME_COOKIE_NAME, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}
