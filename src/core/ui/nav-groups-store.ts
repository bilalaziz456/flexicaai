"use client";

/**
 * Which sidebar groups the user has explicitly opened or closed, persisted in
 * `localStorage` so the choice survives a navigation.
 *
 * A STORE rather than component state, for one specific reason: reading
 * `localStorage` during render breaks hydration — the server has no idea what is in
 * it, so the first client render must match the server's and can only be corrected
 * afterwards. The shell did that with `useState({})` plus an effect that read storage
 * and set state, which is the shape `react-hooks/set-state-in-effect` objects to and
 * is also a real (if brief) flash of every group collapsed.
 *
 * `useSyncExternalStore` is React's answer to exactly this: it takes a separate
 * SERVER snapshot, so the mismatch is declared rather than papered over, and the
 * subscription means a write from one shell (the sidebar and the mobile drawer are
 * two mounts) is seen by the other immediately. The toast queue next door is the same
 * pattern for the same reason.
 */

const KEY = "klenic:nav-groups";

export type NavGroupState = Record<string, boolean>;

/** Frozen empty object — the SAME reference every time, because `useSyncExternalStore`
 *  compares snapshots by identity and a fresh `{}` per call is an infinite loop. */
const EMPTY: NavGroupState = Object.freeze({});

const listeners = new Set<() => void>();

// The parsed value, cached against the raw string it came from. Reading storage on
// every render is cheap, but PARSING it would hand back a new object each time, which
// is the same identity trap as `EMPTY`.
let cachedRaw: string | null = null;
let cached: NavGroupState = EMPTY;

function read(): NavGroupState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Private mode, or storage disabled. A nav preference is not worth a broken page.
    return EMPTY;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  if (!raw) {
    cached = EMPTY;
    return cached;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything could be under this key — another tab, an older build, a person with
    // devtools open. Only a plain object of booleans is usable.
    cached =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).filter(
              ([, v]) => typeof v === "boolean",
            ),
          ) as NavGroupState)
        : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

export function subscribeNavGroups(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another TAB writing the key fires `storage` here; same-tab writes notify directly.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const getNavGroups = read;

/** The server renders with nothing remembered, which is what it can honestly know. */
export const getNavGroupsServer = (): NavGroupState => EMPTY;

export function setNavGroupOpen(group: string, open: boolean): void {
  const next = { ...read(), [group]: open };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Unwritable storage still updates this session — it just will not outlive it.
  }
  cachedRaw = JSON.stringify(next);
  cached = next;
  for (const l of listeners) l();
}
