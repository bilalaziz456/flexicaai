"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/** Id of the zero-height marker the list renders directly under its header row. */
export const HEADER_SENTINEL_ID = "appointments-header-end";

/**
 * The floating "New appointment" button.
 *
 * On a PHONE it is simply always there — the header's "New appointment" button is
 * `hidden sm:inline-flex`, so this is the only way to create one and hiding it would
 * remove the action entirely.
 *
 * From `sm` up it appears only once the header's button has scrolled out of view, so
 * the two are never on screen together — a second, redundant control competing with
 * the real one. That is the whole behaviour: the page keeps its clean header, and the
 * action follows you down a long list.
 *
 * **It toggles a class on the node instead of holding React state.** Three reasons,
 * and the first is the one that decided it: setting state from the effect trips
 * `react-hooks/set-state-in-effect`, a rule this repo deliberately does not mute
 * (`scripts/verify.mjs`). It also avoids a re-render on every crossing, and it keeps
 * the server and client markup identical, so there is no hydration mismatch to
 * reason about. Safe here because the component has no state or changing props, so
 * React never re-renders it and never overwrites the class.
 *
 * An IntersectionObserver rather than a scroll listener: no work per scroll frame,
 * and it reacts to the header leaving for ANY reason (a filter collapsing the
 * calendar, a resize) rather than only to a scroll delta. `rootMargin` pulls the
 * trigger line down past the shell's sticky top bar, which would otherwise cover the
 * header while the marker still counted as visible.
 */
export function NewAppointmentFab({ href }: { href: string }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /** Reveal it at `sm` and up. Below `sm` the class never applied anyway. */
    const show = () => el.classList.remove("sm:hidden");

    const marker = document.getElementById(HEADER_SENTINEL_ID);
    // Fail VISIBLE, never hidden. If the marker is gone or the browser has no
    // IntersectionObserver, a second button beside the header one is a cosmetic
    // wart; staying hidden would take "New appointment" away from a desktop user who
    // has scrolled, with nothing on screen to explain why.
    if (!marker || typeof IntersectionObserver === "undefined") {
      show();
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => el.classList.toggle("sm:hidden", entry.isIntersecting),
      // Roughly the sticky top bar's height, so the button arrives as the header
      // slides under it rather than a beat later.
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    io.observe(marker);
    return () => io.disconnect();
  }, []);

  return (
    <Link
      ref={ref}
      href={href}
      aria-label="New appointment"
      className={cn(
        buttonVariants({ size: "icon" }),
        "fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-lg",
        // `sm:hidden`, not an opacity fade: a button that is invisible but still
        // clickable and still in the tab order is worse than one that is not there.
        // The effect above removes this class once the header has scrolled away.
        "sm:hidden",
      )}
    >
      <Plus className="size-6" aria-hidden="true" />
    </Link>
  );
}
