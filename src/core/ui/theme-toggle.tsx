"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePreference } from "@/core/theme/actions";
import {
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "@/core/theme/theme";
import { cn } from "@/core/lib/utils";

/** Applies a preference to <html> immediately (before the server round-trip). */
function applyTheme(pref: ThemePreference) {
  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  const dark = pref === "dark" || (pref === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState<ThemePreference>(initial);

  function choose(pref: ThemePreference) {
    setTheme(pref);
    applyTheme(pref);
    // Mirror to the cookie so the next server render is correct with no flash.
    document.cookie = `${THEME_COOKIE_NAME}=${pref}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
    // Persist to the account (fire-and-forget; the UI already updated).
    void setThemePreference(pref);
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border bg-card p-0.5"
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            theme === value &&
              "bg-primary text-primary-foreground hover:text-primary-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
