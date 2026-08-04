"use client";

import { Moon, Sun } from "lucide-react";
import {
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "@/core/theme/theme";

/**
 * Light/dark switch for the PUBLIC site.
 *
 * Deliberately not `core/ui/theme-toggle.tsx`: that one also persists the choice to
 * the signed-in user's account via a server action behind `requireUser()`, which a
 * visitor has no session for. This writes only the cookie the no-flash script reads
 * (core/theme/theme-script.ts), so the choice survives navigation and return visits
 * without any account.
 *
 * Holds NO React state on purpose. The `dark` class on <html> is already the single
 * source of truth — the no-flash script sets it before paint — so both icons render
 * and CSS picks the right one. That keeps the button correct during hydration (a
 * state-based version cannot know, server-side, how "system" resolved) and means the
 * icon can never drift from the actual theme.
 */
export function ThemeSwitch() {
  function toggle() {
    const next: ThemePreference = document.documentElement.classList.contains("dark")
      ? "light"
      : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE_NAME}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
      className="flex size-9 items-center justify-center rounded-full text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  );
}
