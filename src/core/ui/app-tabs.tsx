"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/ui/toast";
import {
  MAX_APP_TABS,
  activateAppTab,
  appTabsEnabled,
  closeAppTab,
  findSectionTab,
  getActiveAppTabId,
  getAppTabs,
  getAppTabsServer,
  initAppTabs,
  openAppTab,
  setAppTabSections,
  setAppTabTitle,
  subscribeAppTabs,
  syncActiveTab,
} from "@/core/ui/app-tabs-store";

const FULL = `You can have up to ${MAX_APP_TABS} tabs open. Close one first.`;

/**
 * Opens `href` in a new in-app tab. For a control that wants "open in new tab"
 * behaviour (a table row, say). Returns false when the panel has no tabs, so the
 * caller falls back to an ordinary navigation.
 */
export function useOpenInAppTab() {
  const router = useRouter();
  return (href: string): boolean => {
    const r = openAppTab(href);
    if (r === "off") return false;
    if (r === "full") toast.error(FULL);
    else router.push(href);
    return true;
  };
}

/**
 * The in-app tab strip. Generic: it knows no routes. `homeHref` is where "+" opens,
 * `currentTitle` names a page that has not named itself (the shell passes the nav
 * label), and `storageKey` keeps each user's tabs apart on a shared computer.
 *
 * Ctrl/⌘-click and middle-click on any link inside the panel open an IN-APP tab rather
 * than a browser tab (owner's call). Caught on the document in the CAPTURE phase so it
 * runs before the link's own handler.
 */
export function AppTabs({
  storageKey,
  homeHref,
  currentTitle,
  sections,
}: {
  storageKey: string;
  homeHref: string;
  currentTitle: string;
  /** The sidebar's sections — one tab each (see `app-tabs-store.ts`). */
  sections: { path: string; exact: boolean }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = search ? `${pathname}?${search}` : pathname;
  const { tabs, activeId } = useSyncExternalStore(subscribeAppTabs, getAppTabs, getAppTabsServer);

  // Sections first, so the very first sync already knows them.
  const sectionsKey = JSON.stringify(sections);
  useEffect(() => {
    setAppTabSections(JSON.parse(sectionsKey) as { path: string; exact: boolean }[]);
    initAppTabs(storageKey);
    syncActiveTab(href, currentTitle);
  }, [sectionsKey, storageKey, href, currentTitle]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const newTab = e.button === 1 || ((e.ctrlKey || e.metaKey) && e.button === 0);
      if (!newTab) {
        // A plain click on a SIDEBAR section (owner's call): go to the tab that
        // already holds that section, or open one for it, rather than replacing the
        // page in the current tab. Links inside a page are untouched.
        if (e.button !== 0 || e.shiftKey || e.altKey || !appTabsEnabled()) return;
        const nav = (e.target as Element | null)?.closest?.("a[data-app-tab-section]") as HTMLAnchorElement | null;
        if (!nav) return;
        const url = new URL(nav.href, location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith(homeHref)) return;
        const tab = findSectionTab(url.pathname, nav.dataset.appTabSection === "exact");
        // Already in this section's tab: let the link do its normal job (back to the
        // section's main page, in place). Only preventDefault — NOT stopPropagation —
        // so the mobile drawer still closes; the link sees defaultPrevented and stays put.
        if (tab && tab.id === getActiveAppTabId()) return;
        e.preventDefault();
        if (tab) {
          const target = activateAppTab(tab.id);
          if (target) router.push(target);
          return;
        }
        const target = url.pathname + url.search;
        const r = openAppTab(target);
        if (r === "full") toast.error(FULL);
        else if (r === "opened") router.push(target);
        return;
      }
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      const url = new URL((a as HTMLAnchorElement).href, location.href);
      // Only this panel's own pages; an external link or a download keeps its default.
      if (url.origin !== location.origin || !url.pathname.startsWith(homeHref)) return;
      if (a.hasAttribute("download") || (a as HTMLAnchorElement).target === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
      const target = url.pathname + url.search;
      const r = openAppTab(target);
      if (r === "full") toast.error(FULL);
      else if (r === "opened") router.push(target);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [homeHref, router]);

  const go = (target: string | null) => {
    if (target) router.push(target);
  };

  // OVERFLOW (owner's call): when the tabs do not fit, an arrow after the last visible
  // tab scrolls to the rest, and one on the left scrolls back. The strip itself scrolls
  // (scrollbar hidden), so a trackpad or touch swipe works too.
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    // Also after this paint and once web fonts land: the saved tabs appear after
    // hydration and a title's width changes when its font loads, and neither is
    // guaranteed to reach the observer — the arrow was missing on first load.
    const raf = requestAnimationFrame(measure);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [tabs]);
  // The page you are on is never hidden behind the arrow.
  useEffect(() => {
    scroller.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest("[data-tab]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);
  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };
  const arrowCls =
    "mb-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

  return (
    // Fixed height whether or not the tabs have loaded yet, so the page below does not
    // jump when the browser's saved tabs appear after hydration.
    <div className="flex h-9 items-end gap-1 border-b border-border/70 px-2 pt-1">
      {edges.left ? (
        <button type="button" aria-label="Show earlier tabs" title="Earlier tabs" onClick={() => scrollBy(-1)} className={arrowCls}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <div
        ref={scroller}
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Open pages"
      >
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            data-tab
            className={cn(
              "group flex h-8 max-w-52 shrink-0 items-center gap-1 rounded-t-lg border border-b-0 pl-3 pr-1 text-sm transition-colors",
              active
                ? "border-border/70 bg-card font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={t.title}
              onClick={() => go(activateAppTab(t.id))}
              onAuxClick={(e) => {
                // Middle-click on a tab closes it, as in a browser.
                if (e.button === 1 && tabs.length > 1) go(closeAppTab(t.id));
              }}
              className="min-w-0 truncate outline-none focus-visible:underline"
            >
              {t.title}
            </button>
            {tabs.length > 1 ? (
              <button
                type="button"
                aria-label={`Close ${t.title}`}
                onClick={() => go(closeAppTab(t.id))}
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                  !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
      </div>
      {edges.right ? (
        <button type="button" aria-label="Show more tabs" title="More tabs" onClick={() => scrollBy(1)} className={arrowCls}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {tabs.length > 0 ? (
        <button
          type="button"
          aria-label="Open a new tab"
          title="New tab"
          onClick={() => {
            const r = openAppTab(homeHref);
            if (r === "full") toast.error(FULL);
            else if (r === "opened") router.push(homeHref);
          }}
          className="mb-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Names the current page's tab — rendered by a page whose own name says more than its
 * section ("test patient", not "Patients"). Renders nothing.
 */
export function TabTitle({ title }: { title: string }) {
  const pathname = usePathname();
  useEffect(() => {
    if (title) setAppTabTitle(pathname, title);
  }, [pathname, title]);
  return null;
}
