"use client";

import { useEffect } from "react";

/**
 * Custom cursor: a small dot that tracks the pointer exactly, and a ring that trails
 * it with some weight. The ring swells over anything clickable.
 *
 * Built directly against the DOM rather than through React state on purpose — this
 * updates every animation frame, and re-rendering a component 60 times a second to
 * move two dots would be far more expensive than the effect itself.
 *
 * Never renders for:
 *  - touch / coarse pointers, where there is no cursor to replace and the dots would
 *    just be two stuck artifacts,
 *  - `prefers-reduced-motion`, where a trailing element is exactly the kind of motion
 *    being asked about.
 * In both cases the native cursor is left completely alone.
 */

/** Anything that should make the ring swell and the native cursor stay hidden. */
const INTERACTIVE = 'a, button, [role="button"], input, textarea, select, label';

export function Cursor() {
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduceMotion) return;

    const dot = document.createElement("div");
    const ring = document.createElement("div");
    dot.className =
      "pointer-events-none fixed left-0 top-0 z-[100] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-teal";
    ring.className =
      "pointer-events-none fixed left-0 top-0 z-[100] size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-teal/60 transition-[width,height,background-color,border-color] duration-200";
    document.body.append(dot, ring);
    document.documentElement.classList.add("has-custom-cursor");

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let frame = 0;

    function onMove(e: PointerEvent) {
      x = e.clientX;
      y = e.clientY;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }

    function onOver(e: PointerEvent) {
      const over = (e.target as Element | null)?.closest?.(INTERACTIVE);
      ring.classList.toggle("size-14", !!over);
      ring.classList.toggle("bg-brand-teal/10", !!over);
      ring.classList.toggle("size-8", !over);
    }

    function loop() {
      // Ease the ring toward the dot — the lag is the whole character of the thing.
      ringX += (x - ringX) * 0.16;
      ringY += (y - ringY) * 0.16;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
      frame = requestAnimationFrame(loop);
    }

    // Hide both when the pointer leaves the window, so they do not sit frozen at the
    // edge of the screen while the visitor is in another app.
    function onLeave() {
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    }
    function onEnter() {
      dot.style.opacity = "1";
      ring.style.opacity = "1";
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
      dot.remove();
      ring.remove();
      document.documentElement.classList.remove("has-custom-cursor");
    };
  }, []);

  return null;
}

/**
 * Magnetic wrapper: its child drifts toward the pointer while the pointer is near,
 * then springs back. Used on the primary calls to action.
 *
 * The element only LOOKS displaced — the transform never moves its hit area far
 * enough to escape the pointer, so the button stays as clickable as it appears.
 */
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-block will-change-transform ${className ?? ""}`}
      onPointerMove={(e) => {
        if (!window.matchMedia("(pointer: fine)").matches) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        el.style.transform = `translate3d(${dx * strength}px, ${dy * strength}px, 0)`;
      }}
      onPointerLeave={(e) => {
        const el = e.currentTarget;
        el.style.transition = "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "translate3d(0, 0, 0)";
        window.setTimeout(() => (el.style.transition = ""), 400);
      }}
    >
      {children}
    </span>
  );
}
