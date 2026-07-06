import "server-only";

import { cookies } from "next/headers";
import {
  DEFAULT_THEME,
  isThemePreference,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "@/core/theme/theme";

/** Reads the theme preference from the cookie (server-side), defaulting to system. */
export async function getThemeCookie(): Promise<ThemePreference> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE_NAME)?.value;
  return isThemePreference(value) ? value : DEFAULT_THEME;
}
