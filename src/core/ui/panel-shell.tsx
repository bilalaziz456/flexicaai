"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  Building2,
  CalendarClock,
  Contact,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Stethoscope,
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
export type PanelId = "admin" | "clinic" | "doctor" | "reception";

/**
 * Per-panel navigation. Icons live here (a client module) so the server layouts
 * only pass a serializable panel id — you can't hand a component across the
 * server/client boundary. Every role gets the same chrome; only the items and
 * the brand link differ.
 */
const NAV_BY_PANEL: Record<PanelId, { brand: string; items: NavItem[] }> = {
  admin: {
    brand: "/admin",
    items: [{ href: "/admin", label: "Clinics", Icon: Building2, exact: true }],
  },
  clinic: {
    brand: "/clinic",
    items: [
      { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
      { href: "/clinic/staff", label: "Staff", Icon: Users },
      { href: "/clinic/patients", label: "Patients", Icon: Contact },
      { href: "/clinic/recalls", label: "Recalls", Icon: BellRing },
    ],
  },
  doctor: {
    brand: "/doctor",
    items: [
      { href: "/doctor", label: "Voice scribe", Icon: Stethoscope, exact: true },
    ],
  },
  reception: {
    brand: "/reception",
    items: [
      { href: "/reception", label: "Appointments", Icon: CalendarClock, exact: true },
      { href: "/reception/whatsapp", label: "WhatsApp", Icon: MessageCircle },
    ],
  },
};

/**
 * Shared panel chrome for every role — desktop left sidebar (logo + icon/text
 * nav + sign out with label) and a mobile top bar with an animated hamburger
 * drawer (sign out is icon-only on mobile). Client component: tracks the active
 * route and drawer state. Server layouts pass the panel id, the identity label
 * (username or clinic name), and the saved theme.
 */
export function PanelShell({
  panel,
  identityLabel,
  theme,
  children,
}: {
  panel: PanelId;
  identityLabel: string;
  theme: ThemePreference;
  children: React.ReactNode;
}) {
  const { brand, items } = NAV_BY_PANEL[panel];
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
          <Link href={brand} className="flex items-center">
            <Logo className="h-7" />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3">{items.map((i) => navLink(i))}</nav>
        <div className="space-y-3 border-t p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="max-w-[9rem] truncate rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              {identityLabel}
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
        <Link href={brand} className="flex items-center">
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
              {identityLabel}
            </span>
          </div>
          <nav className="space-y-1">
            {items.map((i) => navLink(i, () => setOpen(false)))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
