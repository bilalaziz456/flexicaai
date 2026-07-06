/**
 * Theme constants — pure, importable from both client and server.
 * The durable per-account preference lives in users.theme; a same-named cookie
 * mirrors it so the root layout and no-flash script can apply it without a DB
 * call. The cookie is set from the DB value at login and updated on toggle.
 */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

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
