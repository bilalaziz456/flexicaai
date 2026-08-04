"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Makes the hero artwork lean toward the pointer.
 *
 * It publishes two numbers as CSS custom properties on its own element — `--mx` and
 * `--my`, each -1..1 for how far the pointer is from the centre of the window — and
 * the artwork's layers consume them at different strengths (see `.hero-depth-*` in
 * globals.css). One listener drives the whole illustration, and adding or removing a
 * layer needs no change here.
 *
 * Writing custom properties rather than React state is deliberate: this updates on
 * every pointer move, and re-rendering a component tree that often to move some SVG
 * groups would cost far more than the effect is worth. Nothing here re-renders.
 *
 * The eased value chases the target and the loop STOPS once it arrives, so an idle
 * hero costs nothing — unlike a rAF loop left running for the life of the page.
 */
export function HeroParallax({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Leaning toward the cursor is motion tied to input; honour the OS setting.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Nothing to follow without a real pointer, and touch would only ever jump.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const target = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    let frame = 0;

    function tick() {
      eased.x += (target.x - eased.x) * 0.08;
      eased.y += (target.y - eased.y) * 0.08;
      el!.style.setProperty("--mx", eased.x.toFixed(4));
      el!.style.setProperty("--my", eased.y.toFixed(4));

      // Settle and stop rather than spinning forever on a still pointer.
      if (Math.abs(target.x - eased.x) > 0.001 || Math.abs(target.y - eased.y) > 0.001) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    }

    function onMove(e: PointerEvent) {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!frame) frame = requestAnimationFrame(tick);
    }

    // Drift back to centre when the pointer leaves the window.
    function onLeave() {
      target.x = 0;
      target.y = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
