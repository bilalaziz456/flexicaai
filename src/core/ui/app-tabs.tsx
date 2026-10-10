"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/ui/toast";
import {
  MAX_APP_TABS,
  activateAppTab,
  closeAppTab,
  getAppTabs,
  getAppTabsServer,
  initAppTabs,
  openAppTab,
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
}: {
  storageKey: string;
  homeHref: string;
  currentTitle: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = search ? `${pathname}?${search}` : pathname;
  const { tabs, activeId } = useSyncExternalStore(subscribeAppTabs, getAppTabs, getAppTabsServer);

  useEffect(() => {
    initAppTabs(storageKey);
    syncActiveTab(href, currentTitle);
  }, [storageKey, href, currentTitle]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const newTab = e.button === 1 || ((e.ctrlKey || e.metaKey) && e.button === 0);
      if (!newTab) return;
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

  return (
    // Fixed height whether or not the tabs have loaded yet, so the page below does not
    // jump when the browser's saved tabs appear after hydration.
    <div className="flex h-9 items-end gap-1 overflow-x-auto border-b border-border/70 px-2 pt-1 [scrollbar-width:none]" role="tablist" aria-label="Open pages">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
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
