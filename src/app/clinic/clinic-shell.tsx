"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Contact,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/core/auth/actions";
import { Logo } from "@/core/ui/logo";
import { ThemeToggle } from "@/core/ui/theme-toggle";
import type { ThemePreference } from "@/core/theme/theme";
import { cn } from "@/core/lib/utils";

type NavItem = { href: string; label: string; Icon: LucideIcon; exact?: boolean };

const NAV: NavItem[] = [
  { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/clinic/staff", label: "Staff", Icon: Users },
  { href: "/clinic/patients", label: "Patients", Icon: Contact },
];

/**
 * Clinic panel chrome: a left sidebar on desktop (logo + icon/text nav + sign
 * out with label) and a top bar with a hamburger drawer on mobile (sign out is
 * icon-only). Client component so it can track the active route and toggle the
 * drawer; the server layout passes in the clinic name + saved theme.
 */
export function ClinicShell({
  clinicName,
  theme,
  children,
}: {
  clinicName: string;
  theme: ThemePreference;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const navLink = (item: NavItem, onClick?: () => void) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onClick}
      aria-current={isActive(item) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive(item)
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <item.Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );

  return (
    <div className="min-h-screen md:pl-60">
      {/* ---- Desktop sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="p-4">
          <Link href="/clinic" className="flex items-center">
            <Logo className="h-10" />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3">{NAV.map((i) => navLink(i))}</nav>
        <div className="space-y-3 border-t p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="max-w-[9rem] truncate rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              {clinicName}
            </span>
            <ThemeToggle initial={theme} />
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ---- Mobile top bar ---- */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="-ml-1 rounded-md p-1.5 text-foreground hover:bg-accent"
        >
          <Menu className="size-6" aria-hidden="true" />
        </button>
        <Link href="/clinic" className="flex items-center">
          <Logo className="h-8" />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle initial={theme} />
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-5" aria-hidden="true" />
            </button>
          </form>
        </div>
      </header>

      {/* ---- Mobile drawer (slides in/out; backdrop fades) ---- */}
      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300 ease-in-out motion-reduce:transition-none",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r bg-card p-4 shadow-xl transition-transform duration-300 ease-in-out will-change-transform motion-reduce:transition-none",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Logo className="h-8" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="rounded-md p-1.5 text-foreground hover:bg-accent"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <div className="mb-4">
            <span className="inline-block max-w-full truncate rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              {clinicName}
            </span>
          </div>
          <nav className="space-y-1">
            {NAV.map((i) => navLink(i, () => setOpen(false)))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
