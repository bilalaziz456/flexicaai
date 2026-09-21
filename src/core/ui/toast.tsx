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
    // Tokens, not raw emerald/red. The badges and the status tones use --success /
    // --destructive, so a toast saying "saved" in a different green from the badge two
    // inches above it was the same state rendered as two different colours.
    ? "border-destructive/25 bg-destructive/8 text-destructive-text"
    : "border-success/25 bg-success/8 text-success-text";
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

/** What `useActionState` gives a form back. Both fields optional: a form may report
 *  only failure (the success is the page changing) or only success. */
export type ActionResult = { saved?: boolean; error?: string } | null | undefined;

/**
 * Announce a Server Action's result, once per submission.
 *
 * THE PROBLEM IT SOLVES: `useActionState` returns a NEW state object per submission
 * but the SAME message text, so `{state.saved ? <Toast message="Saved." /> : null}`
 * fires on the first save and is silent on every save after it — the user presses the
 * button, nothing visibly happens, and they cannot tell whether it worked. The object's
 * IDENTITY is the only thing that distinguishes one submission from the next.
 *
 * WHY A HOOK RATHER THAN THE NONCE IT REPLACES: twenty-odd forms had each grown
 * `const [nonce, setNonce] = useState(0); useEffect(() => { if (state.saved ||
 * state.error) setNonce((n) => n + 1); }, [state])` — calling setState from an effect
 * purely to make a prop change, which cascades a second render on every submit and is
 * what `react-hooks/set-state-in-effect` is warning about. There is no React state
 * here to update: the toast queue is an external store, and pushing to an external
 * store on a change is precisely what an effect is for. So the nonce is not replaced
 * with a cleverer nonce — the render it existed to trigger is deleted.
 *
 * The ref is what makes it fire ONCE per submission: an effect re-runs for reasons
 * that have nothing to do with a new result (a parent re-render, StrictMode's double
 * invoke in development), and comparing identity means only a genuinely new state
 * object speaks. The initial state seeds it, so a form cannot announce itself on
 * mount — a bug the `<Toast>` call sites had to guard by hand with
 * `state.saved ? message : null`.
 *
 * EACH OUTCOME IS OPTED INTO, and that is not ceremony. Some of these forms print
 * their error beside the field instead, and one prints it nowhere; announcing errors
 * by default would have quietly added a toast to five screens while this change was
 * supposed to be about how the existing ones fire. `saved` gives the success text;
 * `error` turns the failure toast on, carrying whatever the action put in
 * `state.error`. Omit either and it stays silent for that outcome.
 */
export function useActionToast(
  state: ActionResult,
  { saved, error }: { saved?: string | null; error?: boolean } = {},
) {
  const seen = useRef<ActionResult>(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    // Error wins: an action reports ONE outcome, and a form announcing both would be
    // saying two contradictory things in the same corner of the screen.
    if (error && state?.error) pushToast(state.error, { variant: "error" });
    else if (saved && state?.saved) pushToast(saved, { variant: "success" });
  }, [state, saved, error]);
}

/**
 * The same thing as an element, for a form that would rather say it in its JSX.
 * Renders nothing; `useActionToast` is the implementation.
 */
export function ActionToast({
  state,
  saved,
  error,
}: {
  state: ActionResult;
  saved?: string | null;
  error?: boolean;
}) {
  useActionToast(state, { saved, error });
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
