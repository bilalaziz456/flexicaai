"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

type Variant = "success" | "error";

/**
 * Reactive toast. Shows `message` whenever it (or `token`) changes and
 * auto-dismisses. `token` lets the caller re-trigger the same message text
 * (e.g. the same validation error on a second failed submit). Purely
 * presentational — no navigation side effects; use `FlashToast` for the
 * redirect/query-param flash case.
 */
export function Toast({
  message,
  variant = "success",
  token,
}: {
  message: string | null;
  variant?: Variant;
  token?: number | string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setText(message);
    const t = setTimeout(() => setText(null), variant === "error" ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [message, token, variant]);

  if (!text) return null;

  const styles =
    variant === "error"
      ? "border-destructive/30 bg-red-50 text-red-800 dark:border-destructive/40 dark:bg-red-950 dark:text-red-200"
      : "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-200";
  const Icon = variant === "error" ? AlertCircle : CheckCircle2;

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className="fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4"
    >
      <div
        className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg ${styles}`}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {text}
      </div>
    </div>
  );
}

/**
 * Success toast driven by a server-passed flash message (from a `?created=1` /
 * `?updated=1` query param after a redirect). Captures the message on mount and
 * strips the flash param via the History API — NOT `router.replace`, which would
 * trigger a Next navigation that remounts this subtree and cut the toast short —
 * so a refresh won't re-toast while the toast runs its full duration.
 */
export function FlashToast({ message }: { message: string | null }) {
  const [captured, setCaptured] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setCaptured(message);
    const url = new URL(window.location.href);
    if (url.search) {
      window.history.replaceState(window.history.state, "", url.pathname);
    }
  }, [message]);

  return <Toast message={captured} variant="success" />;
}
