"use client";

import { useEffect } from "react";

/**
 * Pauses the artwork when it is not on screen.
 *
 * The homepage runs roughly ninety infinite animations at once — waveform bars, the
 * typing notes, pulsing nodes, the access scan, two aurora glows, four slow spins.
 * All of them kept compositing while parked in a section the visitor had scrolled
 * past, which is pure battery cost on a phone for something nobody can see.
 *
 * WHY THIS PAUSES WHOLE SCOPES AND NOT INDIVIDUAL ELEMENTS: several of these pieces
 * are synchronised by `animation-delay` alone against a shared loop — the four
 * consultation notes run one 28s cycle and each takes a quarter of it. Pausing and
 * resuming elements independently, as they each crossed the viewport edge, would
 * shift their offsets apart permanently and the notes would overlap. Pausing an
 * ancestor stops every descendant at the same instant and restarts them at the same
 * instant, so relative timing inside a scope is preserved exactly.
 *
 * Scopes opt in with `data-motion-scope`. Anything without it keeps running, so this
 * can never silently freeze something that was not considered.
 *
 * No-op under `prefers-reduced-motion: reduce` — every animation here is already
 * behind `motion-safe:`, so there is nothing to pause and no observer worth creating.
 */
export function OffscreenMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scopes = document.querySelectorAll<HTMLElement>("[data-motion-scope]");
    if (scopes.length === 0) return;

    // rootMargin keeps a scope live just outside the viewport, so it is already
    // running by the time it scrolls into view rather than starting from frame zero
    // in front of the visitor.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle("motion-paused", !entry.isIntersecting);
        }
      },
      { rootMargin: "200px 0px" },
    );

    for (const el of scopes) io.observe(el);
    return () => io.disconnect();
  }, []);

  return null;
}
