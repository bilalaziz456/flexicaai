"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectionStatus } from "@/core/ui/connection-status";
import { GlobalSearch, type SearchNavItem } from "@/core/ui/global-search";
// Only the icons the CHROME itself draws. Every route icon moved out with the nav
// (ADR-019) — this list shrinking from 33 to 5 is the clearest measure of how much
// application knowledge was living in shared UI.
import { ChevronRight, LogOut, Menu, UserRound, X } from "lucide-react";
import { signOut } from "@/core/auth/actions";
import { Logo } from "@/core/ui/logo";
import { NotificationBell } from "@/core/ui/notification-bell";
import { ThemeToggle } from "@/core/ui/theme-toggle";
import type { ThemePreference } from "@/core/theme/theme";
import { cn } from "@/core/lib/utils";
import {
  isNavGroup as isGroup,
  type NavGroup,
  type NavItem,
  type NavNode,
  type PanelNav,
} from "@/core/ui/panel-nav";


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

/**
 * Shared panel chrome for every role — desktop left sidebar (logo + icon/text
 * nav + sign out with label) and a mobile top bar with an animated hamburger
 * drawer (sign out is icon-only on mobile). Client component: tracks the active
 * route and drawer state.
 *
 * It knows NOTHING about what routes exist: each panel hands it a `nav`, and gating
 * is declared on the items themselves (ADR-019, delta D-05). Adding a page to a panel
 * is a change to that panel's `nav.ts`, never to this file.
 */
export type PanelShellProps = {
  /** This panel's navigation map, owned by the panel rather than by this shell. */
  nav: PanelNav;
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
  /** Clinic features that are on, keyed by the `feature` a nav item declares (e.g.
   *  `{ sales: true, finance: false }`). An item naming a feature that isn't true
   *  here is hidden. */
  features?: Readonly<Record<string, boolean>>;
  /** Per-request booleans, keyed by the `gate` a nav item declares (e.g.
   *  `{ logs: true, approvals: false }`) — conditions the panel works out that are
   *  neither a permission nor a feature. */
  gates?: Readonly<Record<string, boolean>>;
  /**
   * Permission resources the current user can access (any V/C/E/D). When
   * provided, nav items tagged with a `resource` the user can't access are
   * hidden. Omitted for the super admin (sees everything).
   */
  accessibleResources?: readonly string[];
  /** ADMIN panel: the super-admin's capability slugs — nav items tagged with a
   *  `cap` the user lacks are hidden. Omit for the owner (sees everything). */
  adminCapabilities?: readonly string[];
  /** A full-width bar rendered above the content (e.g. the impersonation banner). */
  banner?: React.ReactNode;
  /** Optional floating pill stacked ABOVE the connectivity indicator, bottom-centre
   *  (e.g. the clinic payment-due notice). Shares one stack so the two never clash. */
  bottomPill?: React.ReactNode;
  children: React.ReactNode;
};

export function PanelShell({
  nav,
  identityLabel,
  userName,
  userInitials = "",
  accountHref = "/account",
  avatarVersion = "none",
  notificationCount = 0,
  theme,
  features,
  gates,
  accessibleResources,
  adminCapabilities,
  banner,
  bottomPill,
  children,
}: PanelShellProps) {
  const { brand, nodes, search } = nav;
  const canSee = accessibleResources ? new Set(accessibleResources) : null;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Per-item gating, entirely from what the item DECLARES. This used to be a chain of
  // seven hardcoded `/clinic/...` hrefs, so every new gated page meant editing shared
  // chrome — and the shell silently decided policy for a panel it shouldn't know.
  const adminCaps = adminCapabilities ? new Set(adminCapabilities) : null;
  const visible = (i: NavItem): boolean => {
    // Admin capability (Feature 9). The owner has adminCaps=null → unrestricted.
    if (i.cap && adminCaps && !adminCaps.has(i.cap)) return false;
    // A clinic feature the super admin switches on.
    if (i.feature && !features?.[i.feature]) return false;
    // A condition the panel worked out for this request.
    if (i.gate && !gates?.[i.gate]) return false;
    // Per-user permission. canSee=null (super admin) → unrestricted.
    if (i.resource && canSee && !canSee.has(i.resource)) return false;
    return true;
  };
  // Filter items inside each group; drop a group that ends up empty.
  const visibleNodes: NavNode[] = nodes
    .map((n) => (isGroup(n) ? { ...n, items: n.items.filter(visible) } : n))
    .filter((n) => (isGroup(n) ? n.items.length > 0 : visible(n)));

  // Flattened for the search box — the SAME already-filtered list the sidebar
  // renders, so search can never offer a page the nav wouldn't show.
  const searchNavItems: SearchNavItem[] = visibleNodes.flatMap((n) =>
    isGroup(n)
      ? n.items.map((i) => ({ href: i.href, label: i.label, group: n.group }))
      : [{ href: n.href, label: n.label }],
  );
  // Where search sends its results is the panel's business too. `search: null` — the
  // cross-tenant admin panel — means no search box at all.
  const searchBox = search ? (
    <GlobalSearch
      navItems={searchNavItems}
      patientBase={search.patientBase}
      appointmentBase={search.appointmentBase}
      documentPages={search.documentPages}
    />
  ) : null;

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

  // Reserve just enough bottom space to clear the floating pill stack — grows with the
  // NUMBER of pills actually showing (payment-due + a transient no-internet toast, …).
  // Measured at runtime (a ResizeObserver on the stack) so it tracks pills that pop in
  // client-side too; 0 when nothing shows → the page keeps its normal padding.
  const stackRef = useRef<HTMLDivElement>(null);
  const [pillPad, setPillPad] = useState(0);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    // Stack sits `bottom-4` (16px) up; clear its height + that offset + a gap
    // (~65px for one pill, growing as more stack).
    const measure = () => setPillPad(el.offsetHeight > 0 ? el.offsetHeight + 16 + 17 : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const navLink = (item: NavItem, onClick?: () => void) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onClick}
      aria-current={isActive(item) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent hover:text-accent-foreground"
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
      {/* Skip link — the FIRST focusable element, so a keyboard user can Tab once and
          jump past the sidebar nav to the page content (WCAG 2.4.1). Hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg outline-none focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to content
      </a>
      {/* ---- Desktop sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="p-4">
          <Link href={brand} className="flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo className="h-9" />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">{renderNodes()}</nav>
        <div className="border-t p-3">
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ---- Desktop top bar (clinic name left; theme + profile top-right) ---- */}
      <header className="sticky top-0 z-20 hidden items-center justify-between gap-3 border-b bg-card px-6 py-2 md:flex">
        <span className="max-w-xs shrink-0 truncate text-sm font-medium text-muted-foreground">
          {identityLabel}
        </span>
        {searchBox ? (
          <div className="mx-auto w-full max-w-md px-4">{searchBox}</div>
        ) : null}
        <div className="flex shrink-0 items-center gap-3">
          <NotificationBell initialUnread={notificationCount} />
          <ThemeToggle initial={theme} />
          <Link
            href={accountHref}
            aria-label="Account settings"
            className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent"
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
          className="-ml-1 rounded-md p-1.5 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent"
        >
          <Menu className="size-6" aria-hidden="true" />
        </button>
        <Link href={brand} className="flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo className="h-8" />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell initialUnread={notificationCount} />
          <Link href={accountHref} aria-label="Account settings" className="rounded-full p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <SelfAvatar key={avatarVersion} version={avatarVersion} initials={userInitials} className="size-7" />
          </Link>
          <ThemeToggle initial={theme} />
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-5" aria-hidden="true" />
            </button>
          </form>
        </div>
      </header>

      {/* Mobile search sits on its OWN row: that bar already carries five
          controls, so an inline field would crush the logo. */}
      {searchBox ? (
        <div className="sticky top-[3.75rem] z-30 border-b bg-card px-4 py-2 md:hidden">
          {searchBox}
        </div>
      ) : null}

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
              className="rounded-md p-1.5 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <div className="mb-4">
            <Link
              href={accountHref}
              onClick={() => setOpen(false)}
              className="inline-flex max-w-full items-center gap-2 rounded-full pr-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent"
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
      {/* Bottom padding grows with the pill stack (measured below) so the last content
          never hides under the floating pills, no matter how many are showing. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-5xl px-4 pt-8 outline-none sm:px-6"
        style={{ paddingBottom: pillPad || 32 }}
      >
        {children}
      </main>
      {/* Bottom-centre pill stack: connectivity sits at the very bottom, any
          `bottomPill` (e.g. payment-due notice) stacks directly above it. When one is
          absent the other drops to the bottom. `col-reverse` keeps the connection pill
          (first child) lowest. Its measured height drives the main padding above. */}
      <div
        ref={stackRef}
        className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col-reverse items-center gap-2"
      >
        <ConnectionStatus />
        {bottomPill}
      </div>
    </div>
  );
}
