/**
 * Theme constants — pure, importable from both client and server.
 * The durable per-account preference lives in users.theme; a same-named cookie
 * mirrors it so the root layout and no-flash script can apply it without a DB
 * call. The cookie is set from the DB value at login and updated on toggle.
 */

import { THEME_PREFERENCE_ROWS, type ThemePreferenceCode } from "@/core/db/vocabulary-seed";

/**
 * The codes, derived from the theme_preference vocabulary rather than restated.
 *
 * The list lives in ONE place — `core/db/vocabulary-seed.ts`, which is also the
 * migration seed and what the start-up check compares the database against. Writing
 * it out a second time here is exactly the drift this whole change removed.
 * `vocabulary-seed` is client-safe (no `server-only`), so this module stays usable
 * from a client component.
 */
export const THEME_PREFERENCES: readonly ThemePreferenceCode[] = THEME_PREFERENCE_ROWS.map((r) => r.code);

export type ThemePreference = ThemePreferenceCode;

export const THEME_COOKIE_NAME = "klenic_theme";
export const DEFAULT_THEME: ThemePreference = "system";
// 1 year.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    THEME_PREFERENCES.includes(value as ThemePreference)
  );
}
