"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { isActive, type NavItem } from "./nav-links";
import { ThemeSwitch } from "./theme-switch";

/**
 * The header nav below `md`.
 *
 * The desktop nav is `hidden md:flex`, which left a phone visitor with a logo, a theme
 * toggle and the CTA — no way to reach another page except by scrolling to the footer.
 * Nothing was unreachable, but every page was a cul-de-sac.
 *
 * A panel under the sticky header rather than a slide-in drawer: four links and a sign
 * in do not justify an overlay, a scroll lock and a focus trap, and each of those is
 * something else to get wrong. The panel is in DOM order right after its trigger, so
 * tabbing through it is already correct without trapping anything.
 *
 * Closes on Escape (handing focus back to the trigger, since the trigger is what the
 * keyboard user was on), on a click outside, and on navigation — that last one matters
 * because App Router transitions do not remount this component, so without it the menu
 * would still be sitting open over the page you just asked for.
 */
export function MobileNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  // Which route the menu was opened ON, rather than a plain boolean. Openness is then
  // DERIVED, so arriving anywhere new closes it for free — no effect that watches the
  // pathname and calls setState, which is a cascading render and a lint error besides.
  // It also covers back/forward, which a click handler on the links would miss.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // `setOpenedOn` directly, not the `setOpen` wrapper: the wrapper is a new
      // function every render, so depending on it would rebind this listener on
      // every render for no reason. The setState function itself is stable.
      setOpenedOn(null);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground md:hidden"
      >
        {open ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <>
          {/* Click-away. Sits under the panel and over the page. */}
          <div
            className="fixed inset-0 top-16 z-40 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Anchored to the <header>, which is `sticky` and therefore the nearest
              positioned ancestor — none of the wrappers in between are positioned. */}
          <div
            id="mobile-nav-panel"
            className="absolute inset-x-0 top-full z-50 border-b border-foreground/10 bg-background/95 backdrop-blur-lg md:hidden"
          >
            <nav aria-label="Site" className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6">
              <ul className="flex flex-col">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        // Navigating closes the menu on its own; this covers the one
                        // case that does not change the pathname — tapping the link
                        // for the page you are already on.
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center rounded-lg px-2 py-3 text-base transition-colors",
                          active
                            ? "font-medium text-foreground"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                        )}
                      >
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="mr-2.5 h-4 w-0.5 rounded-full bg-brand-teal"
                          />
                        ) : null}
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li className="mt-1 border-t border-foreground/10 pt-1">
                  <Link
                    href="/login"
                    className="flex items-center rounded-lg px-2 py-3 text-base text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    Sign in
                  </Link>
                </li>
                {/* The theme switch lives here below md rather than in the header bar.
                    At 320px the bar could not hold the logo, a menu button, a theme
                    button and the CTA — it ran 19px past the viewport — and of those
                    four this is the one with somewhere sensible to go. */}
                <li className="mt-1 flex items-center justify-between border-t border-foreground/10 px-2 pt-3 pb-1">
                  <span className="text-base text-muted-foreground">Theme</span>
                  <ThemeSwitch />
                </li>
              </ul>
            </nav>
          </div>
        </>
      ) : null}
    </>
  );
}
