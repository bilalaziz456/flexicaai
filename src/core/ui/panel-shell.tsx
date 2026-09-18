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

  /**
   * What the header calls the current page. Read off the nav the panel already handed
   * us — no new data, no new prop, and it can never name a page the sidebar is hiding.
   * Longest matching href wins, so `/clinic/patients/[id]` resolves to Patients rather
   * than to whichever shorter prefix also matched.
   */
  const currentLabel = visibleNodes
    .flatMap((n): NavItem[] => (isGroup(n) ? n.items : [n]))
    .filter(isActive)
    .sort((a, b) => b.href.length - a.href.length)[0]?.label;

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

  /**
   * Escape closes the drawer, and the page behind it stops scrolling while it is open.
   * The drawer is hand-rolled rather than a Base UI Dialog, so it never inherited
   * either behaviour — on a phone you could scroll the page underneath the overlay,
   * and the only way out was to hit the backdrop. Both are interaction defects, not
   * new features.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  /**
   * A nav row. The active state is a LIFTED SURFACE, not a filled block.
   *
   * It used to be `bg-primary text-primary-foreground` — a solid teal slab with navy
   * text. That made the single most repeated element in the product also the loudest
   * thing on the screen, and it spent the brand colour on "you are here", which is the
   * one fact the user already knows. Now the sidebar sits on the ground tone and the
   * active row rises out of it as a card with a teal rail; the colour is reduced to a
   * 2px edge and the icon, where it reads as an accent instead of a shout.
   */
  const navLink = (item: NavItem, onClick?: () => void) => {
    const active = isActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/nav relative flex items-center gap-2.5 rounded-lg py-2 pr-3 pl-3.5 text-sm transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          active
            ? "bg-card font-semibold text-foreground elev-1"
            : "font-medium text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
        )}
      >
        {active ? (
          <span
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary"
            aria-hidden="true"
          />
        ) : null}
        <item.Icon
          className={cn(
            "size-[1.05rem] shrink-0 transition-colors",
            active ? "text-primary-text" : "text-muted-foreground/80 group-hover/nav:text-foreground",
          )}
          aria-hidden="true"
        />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  /** Render the nav tree (top-level items + collapsible groups). */
  const renderNodes = (onNavClick?: () => void) =>
    visibleNodes.map((n) => {
      if (!isGroup(n)) return navLink(n, onNavClick);
      const openGroup = isGroupOpen(n);
      return (
        <div key={n.group}>
          {/* A section, not another button competing with its own children. The label
              is set as a quiet micro-caption so the eye reads the group as a heading
              and the pages inside it as the list — the old styling made the group look
              exactly like the items, so a nine-row sidebar read as nine equal things. */}
          <button
            type="button"
            onClick={() => setGroupOpen(n.group, !openGroup)}
            aria-expanded={openGroup}
            className={cn(
              "flex w-full items-center justify-between rounded-lg py-1.5 pr-2 pl-3.5 text-2xs font-semibold tracking-wider uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              groupHasActive(n) && !openGroup
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2.5">
              <n.Icon className="size-[0.95rem] shrink-0 opacity-70" aria-hidden="true" />
              {n.group}
            </span>
            <span className="flex items-center gap-1.5">
              {/* A collapsed group holding the active page would otherwise give no sign
                  that the current location is inside it. */}
              {groupHasActive(n) && !openGroup ? (
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              ) : null}
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-200",
                  openGroup && "rotate-90",
                )}
                aria-hidden="true"
              />
            </span>
          </button>
          {openGroup ? (
            <div className="mt-0.5 mb-1 space-y-0.5 pl-2.5">
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
    <div className="app-root min-h-screen overflow-x-clip md:pl-64">
      {/* Skip link — the FIRST focusable element, so a keyboard user can Tab once and
          jump past the sidebar nav to the page content (WCAG 2.4.1). Hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg outline-none focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to content
      </a>
      {/* ---- Desktop sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="px-4 pt-5 pb-4">
          <Link
            href={brand}
            className="flex items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Logo className="h-8" />
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">{renderNodes()}</nav>
        {/* No top border: the sign-out sits on the same ground as the nav and is
            separated by space instead of a rule. One less line on the screen. */}
        <div className="px-3 pt-2 pb-4">
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg py-2 pr-3 pl-3.5 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 hover:bg-destructive/8 hover:text-destructive-text"
            >
              <LogOut className="size-[1.05rem] shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ONE sticky stack, not three competing ones. The banner and the top bar were
          both `sticky top-0`, so they pinned to the SAME spot and the banner (higher z)
          painted straight over the clinic name and the search box the moment the page
          scrolled. Stacked inside a single sticky wrapper they sit one under the other
          and stay put together — and the mobile search bar no longer needs a hand-tuned
          `top-[3.75rem]` offset that any change in header height would falsify. */}
      {/* `bg-card` is load-bearing, not decoration: the notice bars tint with /15
          alphas (`bg-amber-500/15`), which is 85% transparent. Unpinned that never
          showed, but a STICKY translucent bar lets the page scroll visibly through it.
          The opaque base restores the tint's intended look over card colour. */}
      {/* Frosted rather than opaque. The opaque base was there because the notice bars
          tint with /15 alphas and a translucent sticky bar let the page scroll visibly
          through them; `backdrop-blur` solves the same problem the other way — what
          shows through is diffused, so the tint still reads as a tint. The /85 base
          keeps it legible where backdrop-filter is unsupported. */}
      <div className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        {banner}
        {/* ---- Desktop top bar (clinic name left; theme + profile top-right) ---- */}
        <header className="hidden items-center justify-between gap-4 border-b border-border/70 px-6 py-2.5 md:flex">
        {/* Where you are, then whose data you are looking at. The clinic name alone
            answered the second question and left the first to the sidebar, which meant
            the header carried no information about the page at all. */}
        <div className="flex min-w-0 shrink items-baseline gap-2">
          {currentLabel ? (
            <span className="truncate font-display text-[0.95rem] font-semibold tracking-[-0.015em]">
              {currentLabel}
            </span>
          ) : null}
          <span className="hidden max-w-[14rem] shrink truncate text-xs text-muted-foreground lg:inline">
            {currentLabel ? <span className="mr-2 text-border">/</span> : null}
            {identityLabel}
          </span>
        </div>
        {searchBox ? (
          <div className="mx-auto w-full max-w-sm shrink-0">{searchBox}</div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">
          <NotificationBell initialUnread={notificationCount} />
          <ThemeToggle initial={theme} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Link
            href={accountHref}
            aria-label="Account settings"
            className="flex items-center gap-2 rounded-full py-0.5 pr-3 pl-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 hover:bg-foreground/[0.05]"
          >
            <SelfAvatar key={avatarVersion} version={avatarVersion} initials={userInitials} className="size-7" />
            <span className="max-w-[10rem] truncate text-sm font-medium">{userName}</span>
          </Link>
        </div>
      </header>

      {/* ---- Mobile top bar ---- */}
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-2.5 md:hidden">
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
        <div className="border-b border-border/70 px-4 pt-0.5 pb-2 md:hidden">
          {searchBox}
        </div>
      ) : null}
      </div>

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

      {/* Bottom padding grows with the pill stack (measured below) so the last content
          never hides under the floating pills, no matter how many are showing. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[80rem] px-4 pt-7 outline-none sm:px-6 lg:px-8"
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
