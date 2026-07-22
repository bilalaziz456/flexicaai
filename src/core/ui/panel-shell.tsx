"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectionStatus } from "@/core/ui/connection-status";
import {
  BadgeCheck,
  BellRing,
  Building2,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  ClipboardList,
  Contact,
  FileSpreadsheet,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  MessageCircle,
  Mic,
  PieChart,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  TicketPercent,
  Trash2,
  TrendingUp,
  UserCog,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/core/auth/actions";
import { Logo } from "@/core/ui/logo";
import { NotificationBell } from "@/core/ui/notification-bell";
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
  /** ADMIN panel: required admin capability slug; hidden if the user lacks it. */
  cap?: string;
  /** ADMIN panel: only a team manager (owner or super_admin) sees this item. */
  teamManager?: boolean;
};

/** A collapsible parent tab that groups related items under a ">" disclosure. */
type NavGroup = { group: string; Icon: LucideIcon; items: NavItem[] };
type NavNode = NavItem | NavGroup;
const isGroup = (n: NavNode): n is NavGroup => "group" in n;

/** The signed-in user's own avatar (from /api/me/avatar); falls back to the name
 * initials (matching the settings page), or a generic icon when there's no name.
 * `version` (the avatar key) busts the cache so a new upload shows immediately —
 * keyed by it at the call site so the component remounts on change. When the user
 * has no picture (version "none") we skip the request and show initials directly. */
function SelfAvatar({ className, version, initials }: { className?: string; version?: string; initials?: string }) {
  const hasImage = Boolean(version) && version !== "none";
  const [ok, setOk] = useState(hasImage);
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
  if (initials) {
    return (
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[0.7rem] font-semibold uppercase text-accent-foreground",
          className,
        )}
        aria-hidden="true"
      >
        {initials}
      </span>
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
const NAV_BY_PANEL: Record<PanelId, { brand: string; nodes: NavNode[] }> = {
  admin: {
    brand: "/admin",
    nodes: [
      { href: "/admin", label: "Clinics", Icon: Building2, exact: true, cap: "clinics:view" },
      { href: "/admin/logs", label: "Activity log", Icon: ScrollText },
      { href: "/admin/announcements", label: "Announcements", Icon: Megaphone, cap: "announcements:view" },
      { href: "/admin/team", label: "Team", Icon: Users, teamManager: true },
      { href: "/admin/security", label: "Security", Icon: ShieldCheck },
      { href: "/admin/account", label: "Account settings", Icon: UserCog, cap: "account:view" },
      { href: "/admin/trash", label: "Trash", Icon: Trash2, cap: "clinics:edit" },
    ],
  },
  clinic: {
    brand: "/clinic",
    // Top-level items stay flat; the rest are grouped under collapsible parents.
    nodes: [
      { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
      { href: "/clinic/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments" },
      { href: "/clinic/patients", label: "Patients", Icon: Contact, resource: "patients" },
      { href: "/clinic/scribe", label: "Voice scribe", Icon: Mic, resource: "clinical" },
      {
        group: "Finance",
        Icon: Wallet,
        items: [
          { href: "/clinic/sales", label: "Sales", Icon: TrendingUp, resource: "sales" },
          { href: "/clinic/payments", label: "Payments", Icon: HandCoins, resource: "billing" },
          { href: "/clinic/receivables", label: "Receivables", Icon: HandCoins, resource: "receivables" },
          { href: "/clinic/discounts", label: "Discounts", Icon: TicketPercent, resource: "discounts" },
          { href: "/clinic/shares", label: "Revenue shares", Icon: PieChart, resource: "shares" },
          { href: "/clinic/expenses", label: "Expenses", Icon: Receipt, resource: "expenses" },
          { href: "/clinic/pl", label: "Profit & Loss", Icon: Wallet, resource: "finance" },
          { href: "/clinic/reports", label: "Reports", Icon: FileSpreadsheet },
          { href: "/clinic/approvals", label: "Discount approvals", Icon: BadgeCheck },
        ],
      },
      {
        group: "Operations",
        Icon: ClipboardList,
        items: [
          { href: "/clinic/procedures", label: "Procedures", Icon: ClipboardList, resource: "procedures" },
          { href: "/clinic/doctors", label: "Doctors", Icon: UserCog, resource: "leave" },
          { href: "/clinic/no-shows", label: "No-shows", Icon: CalendarX2, resource: "appointments" },
          { href: "/clinic/whatsapp", label: "WhatsApp", Icon: MessageCircle, resource: "whatsapp" },
          { href: "/clinic/recalls", label: "Recalls", Icon: BellRing, resource: "recalls" },
        ],
      },
      {
        group: "Admin",
        Icon: Users,
        items: [
          { href: "/clinic/staff", label: "Staff", Icon: Users, resource: "staff" },
          { href: "/clinic/settings", label: "Settings", Icon: Settings },
          { href: "/clinic/trash", label: "Trash", Icon: Trash2, resource: "trash" },
          { href: "/clinic/logs", label: "Activity log", Icon: ScrollText },
        ],
      },
    ],
  },
  doctor: {
    brand: "/doctor",
    nodes: [
      { href: "/doctor", label: "Voice scribe", Icon: Stethoscope, exact: true, resource: "clinical" },
      { href: "/doctor/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments" },
      { href: "/doctor/patients", label: "Patients", Icon: Contact, resource: "patients" },
    ],
  },
  reception: {
    brand: "/reception",
    nodes: [
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
  "/clinic/payments",
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
  userInitials = "",
  accountHref = "/account",
  avatarVersion = "none",
  notificationCount = 0,
  theme,
  logsEnabled = true,
  salesEnabled = false,
  financeEnabled = false,
  approvalsEnabled = false,
  accessibleResources,
  adminCapabilities,
  canManageTeam = false,
  banner,
  children,
}: {
  panel: PanelId;
  identityLabel: string;
  /** The signed-in user's display name (with prefix, e.g. "Dr. Bilal Aziz"). */
  userName: string;
  /** Up-to-two-letter initials for the avatar fallback (no prefix, e.g. "BA"). */
  userInitials?: string;
  /** Where the profile/avatar links go (in-panel Settings for a clinic user). */
  accountHref?: string;
  /** The user's avatar key (or "none") — busts the top-bar avatar cache on change. */
  avatarVersion?: string;
  /** Initial unread notification count (server-rendered so the badge has no flash). */
  notificationCount?: number;
  theme: ThemePreference;
  /** Clinic panel: hide the Activity-log nav item when the clinic has no log access. */
  logsEnabled?: boolean;
  /** Hide Procedures/Sales nav items unless the clinic has the `sales` feature. */
  salesEnabled?: boolean;
  /** Hide Expenses/P&L nav items unless the clinic has the `finance` feature. */
  financeEnabled?: boolean;
  /** Show the Discount-approvals nav only for potential approvers (a doctor, or a
   * user holding the discount-approval capability). */
  approvalsEnabled?: boolean;
  /**
   * Permission resources the current user can access (any V/C/E/D). When
   * provided, nav items tagged with a `resource` the user can't access are
   * hidden. Omitted for the super admin (sees everything).
   */
  accessibleResources?: readonly string[];
  /** ADMIN panel: the super-admin's capability slugs — nav items tagged with a
   *  `cap` the user lacks are hidden. Omit for the owner (sees everything). */
  adminCapabilities?: readonly string[];
  /** ADMIN panel: whether the user is an owner (sees `ownerOnly` items). */
  canManageTeam?: boolean;
  /** A full-width bar rendered above the content (e.g. the impersonation banner). */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { brand, nodes } = NAV_BY_PANEL[panel];
  const canSee = accessibleResources ? new Set(accessibleResources) : null;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Per-item gating, in order: feature flags (Activity log / Sales / Finance) then
  // per-user permissions (a resource-tagged item needs access to that resource).
  const adminCaps = adminCapabilities ? new Set(adminCapabilities) : null;
  const visible = (i: NavItem): boolean => {
    // ADMIN panel: gate by admin capability / owner (Feature 9).
    if (i.teamManager) return canManageTeam;
    if (i.cap && adminCaps && !adminCaps.has(i.cap)) return false;
    if (i.href === "/clinic/logs") return logsEnabled;
    if (i.href === "/clinic/approvals") return approvalsEnabled;
    if (i.href === "/clinic/expenses") return financeEnabled && (!canSee || canSee.has("expenses"));
    if (i.href === "/clinic/pl") return financeEnabled && (!canSee || canSee.has("finance"));
    if (i.href === "/clinic/receivables")
      return salesEnabled && (!canSee || canSee.has("receivables"));
    if (i.href === "/clinic/reports") return salesEnabled; // the hub gates each card itself
    if (SALES_HREFS.has(i.href) && !salesEnabled) return false;
    if (i.resource && canSee && !canSee.has(i.resource)) return false;
    return true;
  };
  // Filter items inside each group; drop a group that ends up empty.
  const visibleNodes: NavNode[] = nodes
    .map((n) => (isGroup(n) ? { ...n, items: n.items.filter(visible) } : n))
    .filter((n) => (isGroup(n) ? n.items.length > 0 : visible(n)));

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const groupHasActive = (g: NavGroup) => g.items.some(isActive);

  // A group is open if the user toggled it, else auto-open when it holds the active
  // page. Explicit toggles persist across navigations.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("klenic:nav-groups");
      if (raw) setExpandedGroups(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const setGroupOpen = (name: string, next: boolean) =>
    setExpandedGroups((prev) => {
      const merged = { ...prev, [name]: next };
      try {
        localStorage.setItem("klenic:nav-groups", JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      return merged;
    });
  const isGroupOpen = (g: NavGroup) => expandedGroups[g.group] ?? groupHasActive(g);

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

  /** Render the nav tree (top-level items + collapsible groups). */
  const renderNodes = (onNavClick?: () => void) =>
    visibleNodes.map((n) => {
      if (!isGroup(n)) return navLink(n, onNavClick);
      const openGroup = isGroupOpen(n);
      return (
        <div key={n.group}>
          <button
            type="button"
            onClick={() => setGroupOpen(n.group, !openGroup)}
            aria-expanded={openGroup}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="flex items-center gap-3">
              <n.Icon className="size-4 shrink-0" aria-hidden="true" />
              {n.group}
            </span>
            <ChevronRight
              className={cn("size-4 shrink-0 transition-transform", openGroup && "rotate-90")}
              aria-hidden="true"
            />
          </button>
          {openGroup ? (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-2">
              {n.items.map((i) => navLink(i, onNavClick))}
            </div>
          ) : null}
        </div>
      );
    });

  return (
    // overflow-x-clip: a page-level guard so no descendant (a non-shrinking grid/flex
    // item, a long unbroken string, a wide chart) can force the whole page to scroll
    // sideways. `clip` (not `hidden`) doesn't create a scroll container, so the sticky
    // headers below keep working; content that needs to scroll uses its own
    // overflow-x-auto box.
    <div className="min-h-screen overflow-x-clip md:pl-60">
      {/* ---- Desktop sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="p-4">
          <Link href={brand} className="flex items-center">
            <Logo className="h-7" />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">{renderNodes()}</nav>
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
          <NotificationBell initialUnread={notificationCount} />
          <ThemeToggle initial={theme} />
          <Link
            href={accountHref}
            aria-label="Account settings"
            className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 transition-colors hover:bg-accent"
          >
            <SelfAvatar key={avatarVersion} version={avatarVersion} initials={userInitials} className="size-7" />
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
          <NotificationBell initialUnread={notificationCount} />
          <Link href={accountHref} aria-label="Account settings" className="rounded-full p-0.5">
            <SelfAvatar key={avatarVersion} version={avatarVersion} initials={userInitials} className="size-7" />
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
              <SelfAvatar key={avatarVersion} version={avatarVersion} initials={userInitials} />
              <span className="truncate text-xs font-medium text-muted-foreground">
                {identityLabel}
              </span>
            </Link>
          </div>
          <nav className="space-y-1 overflow-y-auto">{renderNodes(() => setOpen(false))}</nav>
        </div>
      </div>

      {banner ? <div className="sticky top-0 z-40">{banner}</div> : null}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      <ConnectionStatus />
    </div>
  );
}
