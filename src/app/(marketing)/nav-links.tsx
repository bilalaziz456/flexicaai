"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/core/lib/utils";

/**
 * The nav links, split out as a client component solely so they can know which page
 * you are on. Everything else in the marketing layout stays a server component.
 *
 * This does NOT make the pages dynamic: `usePathname` is a client hook, and Next still
 * renders client components into the prerendered HTML for a static route. Each page is
 * prerendered separately, so the correct link is already marked active in the HTML
 * before any JavaScript runs — no flash of a wrong state, and it is right even if the
 * script never loads.
 *
 * `aria-current="page"` is the part that actually matters. The underline tells a
 * sighted visitor where they are; without the attribute a screen reader user gets
 * nothing at all, since colour and a 1px rule are invisible to them.
 */

export type NavItem = { href: string; label: string };

/** Active for its own page and anything beneath it, so a future child route stays lit. */
function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function HeaderNavLinks({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative py-1 text-sm transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-brand-teal"
              />
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

export function FooterNavLinks({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "transition-colors hover:text-foreground",
                active && "font-medium text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </>
  );
}
