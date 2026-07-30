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
  const id = nextId++;
  const variant = opts?.variant ?? "success";
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
