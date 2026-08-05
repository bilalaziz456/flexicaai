"use client";

/**
 * Global toast queue — a tiny framework-agnostic pub/sub store (client singleton) that
 * backs `<Toaster/>` and the imperative `toast()` API. Lets any client component fire a
 * notification without prop-drilling, and lets multiple toasts STACK + be dismissed
 * (the old single fixed `<Toast>` could only show one at a time). See toast.tsx.
 */

export type ToastVariant = "success" | "error";
export type ToastItem = { id: number; message: string; variant: ToastVariant; duration: number };

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

/** Cap so a burst of events can't fill the screen — oldest drops off. */
const MAX_VISIBLE = 4;

/**
 * Collapse an identical message pushed again within this window.
 *
 * One user action can legitimately push the same text twice. The common shape is a
 * `<Toast>` whose message comes straight off a `useActionState` result, paired with a
 * nonce bumped in an effect on that same state:
 *
 *     useEffect(() => { if (state.error) setErrorNonce((n) => n + 1) }, [state])
 *     <Toast message={state.error ?? null} token={errorNonce} />
 *
 * The message is already set on the commit BEFORE the nonce bump, so the wrapper's
 * effect runs twice for one failed save — once with the old token, once with the new —
 * and "That username is already in use." appeared twice. 27 call sites across 17 files
 * share that shape, so the guard belongs here rather than in each of them.
 *
 * A window rather than a strict key: two distinct user actions producing the same text
 * are seconds apart and still both show. This also absorbs React StrictMode's
 * double-invoke in development.
 */
const DEDUPE_MS = 400;
let recent: { key: string; at: number } | null = null;

function emit() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return items;
}

type ToastOptions = { variant?: ToastVariant; duration?: number };

/** Enqueue a toast; returns its id (usable with `toast.dismiss`). No-op on empty text. */
export function pushToast(message: string, opts?: ToastOptions): number {
  const text = (message ?? "").trim();
  if (!text) return 0;
  const variant = opts?.variant ?? "success";

  // Same text + variant again within the window: treat it as one event.
  const key = `${variant}:${text}`;
  const now = Date.now();
  if (recent && recent.key === key && now - recent.at < DEDUPE_MS) {
    recent = { key, at: now };
    return 0;
  }
  recent = { key, at: now };

  const id = nextId++;
  const duration = opts?.duration ?? (variant === "error" ? 6000 : 4000);
  items = [...items, { id, message: text, variant, duration }];
  if (items.length > MAX_VISIBLE) items = items.slice(items.length - MAX_VISIBLE);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

/**
 * Imperative API: `toast("Saved")`, `toast.error("Failed")`, `toast.dismiss(id)`.
 * Call from any client event handler — no `<Toast>` element needed.
 */
export const toast = Object.assign(
  (message: string, opts?: ToastOptions) => pushToast(message, opts),
  {
    success: (message: string, opts?: Omit<ToastOptions, "variant">) =>
      pushToast(message, { ...opts, variant: "success" }),
    error: (message: string, opts?: Omit<ToastOptions, "variant">) =>
      pushToast(message, { ...opts, variant: "error" }),
    dismiss: dismissToast,
  },
);
