"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  BellRing,
  Building2,
  CalendarClock,
  ClipboardList,
  Contact,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  PieChart,
  ScrollText,
  Settings,
  Stethoscope,
  TicketPercent,
  Trash2,
  TrendingUp,
  UserCog,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/core/auth/actions";
import { Logo } from "@/core/ui/logo";
import { ThemeToggle } from "@/core/ui/theme-toggle";
import type { ThemePreference } from "@/core/theme/theme";
import { cn } from "@/core/lib/utils";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  exact?: boolean;
  /** Permission resource this item maps to; hidden if the user can't access it. */
  resource?: string;
};

/** The signed-in user's own avatar (from /api/me/avatar); falls back to an icon.
 * `version` (the avatar key) busts the cache so a new upload shows immediately —
 * keyed by it at the call site so the component remounts on change. */
function SelfAvatar({ className, version }: { className?: string; version?: string }) {
  const [ok, setOk] = useState(true);
  if (ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/me/avatar?v=${encodeURIComponent(version ?? "")}`}
        alt=""
        onError={() => setOk(false)}
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <UserRound
      className={cn("size-6 shrink-0 rounded-full bg-accent p-1 text-accent-foreground", className)}
      aria-hidden="true"
    />
  );
}
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
    items: [
      { href: "/admin", label: "Clinics", Icon: Building2, exact: true },
      { href: "/admin/logs", label: "Activity log", Icon: ScrollText },
      { href: "/admin/trash", label: "Trash", Icon: Trash2 },
    ],
  },
  clinic: {
    brand: "/clinic",
    items: [
      { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
      { href: "/clinic/scribe", label: "Voice scribe", Icon: Mic, resource: "clinical" },
      { href: "/clinic/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments" },
      { href: "/clinic/patients", label: "Patients", Icon: Contact, resource: "patients" },
      { href: "/clinic/procedures", label: "Procedures", Icon: ClipboardList, resource: "procedures" },
      { href: "/clinic/doctors", label: "Doctors", Icon: UserCog, resource: "leave" },
      { href: "/clinic/whatsapp", label: "WhatsApp", Icon: MessageCircle, resource: "whatsapp" },
      { href: "/clinic/recalls", label: "Recalls", Icon: BellRing, resource: "recalls" },
      { href: "/clinic/sales", label: "Sales", Icon: TrendingUp, resource: "sales" },
      { href: "/clinic/discounts", label: "Discounts", Icon: TicketPercent, resource: "discounts" },
      { href: "/clinic/shares", label: "Revenue shares", Icon: PieChart, resource: "shares" },
      { href: "/clinic/approvals", label: "Discount approvals", Icon: BadgeCheck },
      { href: "/clinic/staff", label: "Staff", Icon: Users, resource: "staff" },
      { href: "/clinic/settings", label: "Settings", Icon: Settings },
      { href: "/clinic/trash", label: "Trash", Icon: Trash2, resource: "trash" },
      { href: "/clinic/logs", label: "Activity log", Icon: ScrollText },
    ],
  },
  doctor: {
    brand: "/doctor",
    items: [
      { href: "/doctor", label: "Voice scribe", Icon: Stethoscope, exact: true, resource: "clinical" },
      { href: "/doctor/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments" },
      { href: "/doctor/patients", label: "Patients", Icon: Contact, resource: "patients" },
    ],
  },
  reception: {
    brand: "/reception",
    items: [
      { href: "/reception", label: "Appointments", Icon: CalendarClock, exact: true, resource: "appointments" },
      { href: "/reception/doctors", label: "Doctors", Icon: Stethoscope, resource: "leave" },
      { href: "/reception/procedures", label: "Procedures", Icon: ClipboardList, resource: "procedures" },
      { href: "/reception/whatsapp", label: "WhatsApp", Icon: MessageCircle, resource: "whatsapp" },
    ],
  },
};

/** Nav hrefs gated by the `sales` feature (hidden until the super admin enables it). */
const SALES_HREFS = new Set([
  "/clinic/procedures",
  "/reception/procedures",
  "/clinic/sales",
  "/clinic/discounts",
]);

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
  userName,
  accountHref = "/account",
  avatarVersion = "none",
  theme,
  logsEnabled = true,
  salesEnabled = false,
  approvalsEnabled = false,
  accessibleResources,
  children,
}: {
  panel: PanelId;
  identityLabel: string;
  /** The signed-in user's display name (with prefix, e.g. "Dr. Bilal Aziz"). */
  userName: string;
  /** Where the profile/avatar links go (in-panel Settings for a clinic user). */
  accountHref?: string;
  /** The user's avatar key (or "none") — busts the top-bar avatar cache on change. */
  avatarVersion?: string;
  theme: ThemePreference;
  /** Clinic panel: hide the Activity-log nav item when the clinic has no log access. */
  logsEnabled?: boolean;
  /** Hide Procedures/Sales nav items unless the clinic has the `sales` feature. */
  salesEnabled?: boolean;
  /** Show the Discount-approvals nav only for potential approvers (a doctor, or a
   * user holding the discount-approval capability). */
  approvalsEnabled?: boolean;
  /**
   * Permission resources the current user can access (any V/C/E/D). When
   * provided, nav items tagged with a `resource` the user can't access are
   * hidden. Omitted for the super admin (sees everything).
   */
  accessibleResources?: readonly string[];
  children: React.ReactNode;
}) {
  const { brand, items: allItems } = NAV_BY_PANEL[panel];
  const canSee = accessibleResources ? new Set(accessibleResources) : null;
  // Nav gating, in order: feature flags (Activity log / Sales feature) then
  // per-user permissions (a resource-tagged item needs access to that resource).
  const items = allItems.filter((i) => {
    if (i.href === "/clinic/logs") return logsEnabled;
    if (i.href === "/clinic/approvals") return approvalsEnabled;
    if (SALES_HREFS.has(i.href) && !salesEnabled) return false;
    if (i.resource && canSee && !canSee.has(i.resource)) return false;
    return true;
  });
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
        <div className="border-t p-3">
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

      {/* ---- Desktop top bar (clinic name left; theme + profile top-right) ---- */}
      <header className="sticky top-0 z-20 hidden items-center justify-between gap-3 border-b bg-card px-6 py-2 md:flex">
        <span className="max-w-xs truncate text-sm font-medium text-muted-foreground">
          {identityLabel}
        </span>
        <div className="flex items-center gap-3">
          <ThemeToggle initial={theme} />
          <Link
            href={accountHref}
            aria-label="Account settings"
            className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 transition-colors hover:bg-accent"
          >
            <SelfAvatar key={avatarVersion} version={avatarVersion} className="size-7" />
            <span className="max-w-[12rem] truncate text-sm font-medium">{userName}</span>
          </Link>
        </div>
      </header>

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
          <Link href={accountHref} aria-label="Account settings" className="rounded-full p-0.5">
            <SelfAvatar key={avatarVersion} version={avatarVersion} className="size-7" />
          </Link>
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
            <Link
              href={accountHref}
              onClick={() => setOpen(false)}
              className="inline-flex max-w-full items-center gap-2 rounded-full pr-3 transition-colors hover:bg-accent"
            >
              <SelfAvatar key={avatarVersion} version={avatarVersion} />
              <span className="truncate text-xs font-medium text-muted-foreground">
                {identityLabel}
              </span>
            </Link>
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
