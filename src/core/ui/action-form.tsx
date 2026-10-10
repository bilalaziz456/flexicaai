"use client";

import { startTransition, useEffect, useRef, type ComponentProps, type Ref } from "react";

/**
 * A `<form>` for a Server Action that does NOT wipe what the user typed when the save
 * fails.
 *
 * WHY THIS EXISTS. With `<form action={formAction}>`, React 19 resets every
 * uncontrolled field once the action finishes — on SUCCESS AND ON ERROR alike. So a
 * form that came back "Phone is required" had also emptied the name, the address and
 * everything else, and the user had to type it all again (owner's report). This
 * submits through `onSubmit` instead, which React does not reset, and resets ONLY
 * when the action reports success — so an "Add …" form still clears for the next
 * entry, and a rejected one keeps every value for correcting.
 *
 * Use it exactly like a form with `action`: pass the dispatch from `useActionState`
 * as `action`, and that hook's `state` as `state`. The button that submitted travels
 * with the data, so a second submit button (`name="then" value="print"`) still works.
 */
export function ActionForm({
  action,
  state,
  resetWhen = succeeded,
  ref,
  children,
  ...rest
}: Omit<ComponentProps<"form">, "action" | "onSubmit" | "ref"> & {
  action: (data: FormData) => void;
  /** The `useActionState` state — watched to reset after a SUCCESSFUL save. Omit
   *  and the form never resets (right for an edit form, which should keep showing
   *  what was saved). */
  state?: unknown;
  /** What counts as success. Default: `saved: true` or `ok: true`. */
  resetWhen?: (state: unknown) => boolean;
  ref?: Ref<HTMLFormElement>;
}) {
  const form = useRef<HTMLFormElement | null>(null);
  // Only a NEW state can mean a new success: the hook hands back a fresh object per
  // submission, so identity tells "this save just finished" from "a re-render".
  const seen = useRef(state);
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (resetWhen(state)) form.current?.reset();
  }, [state, resetWhen]);

  return (
    <form
      {...rest}
      ref={(el) => {
        form.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => action(data));
      }}
    >
      {children}
    </form>
  );
}

/** The app's success shapes: `{ saved: true }` and `{ ok: true }`. */
function succeeded(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as { saved?: unknown; ok?: unknown };
  return s.saved === true || s.ok === true;
}
