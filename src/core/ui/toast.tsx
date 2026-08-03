"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import {
  dismissToast,
  getToasts,
  pushToast,
  subscribeToasts,
  type ToastItem,
} from "./toast-store";

export { toast } from "./toast-store";

const EMPTY: ToastItem[] = [];

/**
 * The single global toast host — mount ONCE (root layout). Renders a bottom-centre
 * STACK of toasts (newest lowest), each of which auto-dismisses, can be dismissed by
 * hand (×), and PAUSES its timer on hover so a slow reader doesn't lose it. Correct
 * live-region semantics per variant. Fed by the `toast()` API + the compat wrappers.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(item.duration);
  const startRef = useRef(0); // set in the effect (Date.now() is impure at render)

  // Auto-dismiss timer that respects hover-pause: on pause we bank the elapsed time,
  // on resume we continue from the remaining time (Sonner-style).
  useEffect(() => {
    if (paused) return;
    startRef.current = Date.now();
    const t = setTimeout(() => dismissToast(item.id), remainingRef.current);
    return () => {
      clearTimeout(t);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current));
    };
  }, [paused, item.id]);

  const isError = item.variant === "error";
  const styles = isError
    ? "border-destructive/30 bg-red-50 text-red-800 dark:border-destructive/40 dark:bg-red-950 dark:text-red-200"
    : "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-200";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg duration-200 animate-in fade-in slide-in-from-bottom-2 ${styles}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{item.message}</span>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss notification"
        className="-mr-1 shrink-0 rounded p-0.5 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-current"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Compat wrapper — renders nothing; pushes `message` into the global queue whenever it
 * (or `token`) changes. Existing `<Toast message={…}/>` call-sites keep working but now
 * stack + dismiss via the `Toaster`. New code should prefer the imperative `toast()`.
 */
export function Toast({
  message,
  variant = "success",
  token,
}: {
  message: string | null;
  variant?: "success" | "error";
  /** Change this to re-fire the SAME message text (e.g. a repeated successful save —
   *  `useActionState` returns the same state, so pass a nonce/timestamp here). */
  token?: number | string;
}) {
  // Push at most once per (message, token, variant). Guards against React StrictMode /
  // any re-render double-invoking the effect and enqueueing the toast twice.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const key = `${variant}:${token ?? ""}:${message}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    pushToast(message, { variant });
  }, [message, token, variant]);
  return null;
}

/**
 * Compat flash — captures a server-passed success message (from a `?created=1` style
 * redirect), strips the query param via the History API (NOT `router.replace`, which
 * would remount and cut the toast short), and enqueues it once.
 */
export function FlashToast({ message }: { message: string | null }) {
  const done = useRef(false); // one-shot: guards the StrictMode double-invoke
  useEffect(() => {
    if (!message || done.current) return;
    done.current = true;
    pushToast(message, { variant: "success" });
    const url = new URL(window.location.href);
    if (url.search) window.history.replaceState(window.history.state, "", url.pathname);
  }, [message]);
  return null;
}
