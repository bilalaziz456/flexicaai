"use client";

import { useEffect } from "react";

/**
 * Glides the page down to the appointments list when a calendar day is clicked
 * (owner, 2026-11-14). Renders nothing; it listens for clicks on `a[data-day-link]`
 * (the month grid's day cells) and smooth-scrolls to `targetId` at the moment of the
 * click, while the day's list loads.
 *
 * WHY not a `#appointment-list` link: Next jumps to a hash instantly, and Chrome made
 * its own fragment jump a second after our smooth scroll, which stalled it halfway
 * and then lurched (measured, 2026-11-14). CSS `scroll-behavior: smooth` is no answer
 * either — it would animate every other navigation on the page (paging, filters),
 * lag in a screen the desk uses all day. Reduced-motion users get the instant jump.
 */
export function ScrollToList({ targetId }: { targetId: string }) {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // A new tab or window (ctrl/shift/middle click) leaves this page where it is.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element) || !e.target.closest("a[data-day-link]")) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(targetId)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [targetId]);
  return null;
}
