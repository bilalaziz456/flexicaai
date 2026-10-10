"use client";

/**
 * In-app tabs — the strip of open pages above the top bar. A STORE for the same reason
 * as `nav-groups-store.ts`: it lives in browser storage the server cannot see, so it is
 * read through `useSyncExternalStore` with an empty server snapshot rather than into
 * state from an effect.
 *
 * A tab is only an ADDRESS (path + query) and a title. Switching tabs navigates to that
 * address, so filters, search and the page come back, but text typed into an unsaved
 * form does not. Keeping every tab's page alive in the background was the alternative;
 * it is much heavier and slows every page, so it was not taken.
 *
 * SESSION storage, keyed per user, not local storage: two browser windows on the same
 * computer would otherwise keep overwriting each other's tabs. Tabs survive a refresh;
 * a new window starts with its own.
 */

export type AppTab = { id: string; href: string; title: string };
type TabsState = { tabs: AppTab[]; activeId: string | null };

/** Enough to switch between; past this the strip stops being readable. */
export const MAX_APP_TABS = 10;

const EMPTY: TabsState = Object.freeze({ tabs: [], activeId: null }) as TabsState;

let key: string | null = null;
let state: TabsState = EMPTY;
const listeners = new Set<() => void>();
/** Titles pages have given themselves (`<TabTitle>`), keyed by PATHNAME. */
const pageTitles = new Map<string, string>();

const pathOf = (href: string) => href.split("?")[0];
const newId = () => Math.random().toString(36).slice(2, 10);

function emit() {
  for (const l of listeners) l();
}

function save() {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private mode or storage disabled: tabs still work, they just won't survive a refresh.
  }
}

function set(next: TabsState) {
  state = next;
  save();
  emit();
}

function load(k: string): TabsState {
  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TabsState>;
    // Anything could be under this key (an older build, devtools); keep only well-formed tabs.
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter(
            (t): t is AppTab =>
              Boolean(t) && typeof t.id === "string" && typeof t.href === "string" && typeof t.title === "string",
          )
          .slice(0, MAX_APP_TABS)
      : [];
    const activeId = tabs.some((t) => t.id === parsed.activeId) ? (parsed.activeId as string) : (tabs[0]?.id ?? null);
    return { tabs, activeId };
  } catch {
    return EMPTY;
  }
}

export function subscribeAppTabs(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getAppTabs = () => state;
export const getAppTabsServer = () => EMPTY;

/** Turns tabs on for this user (the clinic shell calls it). Idempotent. */
export function initAppTabs(storageKey: string) {
  if (key === storageKey) return;
  key = storageKey;
  state = load(storageKey);
  emit();
}

/**
 * The ACTIVE tab follows ordinary navigation: whatever page is showing is what the
 * current tab holds, like a browser tab. Creates the first tab when there is none.
 */
export function syncActiveTab(href: string, fallbackTitle: string) {
  if (!key) return;
  const title = pageTitles.get(pathOf(href)) ?? fallbackTitle;
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (!active) {
    const tab = { id: newId(), href, title };
    set({ tabs: [...state.tabs, tab].slice(-MAX_APP_TABS), activeId: tab.id });
    return;
  }
  if (active.href === href && active.title === title) return;
  set({
    ...state,
    tabs: state.tabs.map((t) => (t.id === active.id ? { ...t, href, title } : t)),
  });
}

/** Opens `href` in a NEW tab and makes it active. False when tabs are off or full. */
export function openAppTab(href: string): "opened" | "full" | "off" {
  if (!key) return "off";
  if (state.tabs.length >= MAX_APP_TABS) return "full";
  const tab = { id: newId(), href, title: pageTitles.get(pathOf(href)) ?? "…" };
  set({ tabs: [...state.tabs, tab], activeId: tab.id });
  return "opened";
}

/** Makes a tab active; returns where to navigate. */
export function activateAppTab(id: string): string | null {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return null;
  if (state.activeId !== id) set({ ...state, activeId: id });
  return tab.href;
}

/**
 * Closes a tab. When it was the active one, its right-hand neighbour (or the left, at
 * the end) becomes active, and that address is returned to navigate to. The last tab
 * cannot be closed: there is always a page showing.
 */
export function closeAppTab(id: string): string | null {
  if (state.tabs.length <= 1) return null;
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) {
    set({ ...state, tabs });
    return null;
  }
  const next = tabs[Math.min(idx, tabs.length - 1)];
  set({ tabs, activeId: next.id });
  return next.href;
}

/**
 * A page naming its own tab ("test patient" rather than the section, "Patients").
 * Runs before the shell's sync (child effects first), so it is RECORDED by pathname
 * and the sync picks it up; it also renames the active tab directly if it already
 * shows this page.
 */
export function setAppTabTitle(pathname: string, title: string) {
  pageTitles.set(pathname, title);
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active && pathOf(active.href) === pathname && active.title !== title) {
    set({ ...state, tabs: state.tabs.map((t) => (t.id === active.id ? { ...t, title } : t)) });
  }
}
