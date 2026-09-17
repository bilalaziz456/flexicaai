"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Steps a composition through a sequence of phases, forever, by stamping
 * `data-phase` on its wrapper. The choreography itself is pure CSS keyed off that
 * attribute (`data-from` / `data-upto` / `data-only`, see "Phase choreography" in
 * globals.css), so this component knows nothing about what the phases mean.
 *
 * Three properties matter:
 *
 *  - It STARTS on the last phase. The server renders the finished scene, and the loop
 *    begins by holding it, then rewinds to 0. So the first paint, a crawler, a link
 *    preview and a visitor without script all see the complete picture — never an
 *    empty frame waiting for JavaScript.
 *  - It only runs while on screen. Off screen it stops where it is, and resumes from
 *    there, so scrolling back does not land mid-way through a half-built scene.
 *  - Under `prefers-reduced-motion` it never starts: the finished scene simply stays.
 *
 * Phases are driven by timeouts, not an animation frame loop — they change a few times
 * a second at most, and a stopped timer costs nothing.
 */
export function PhaseLoop({
  durations,
  children,
  className,
  label,
}: {
  /** How long to hold each phase, in ms. The number of phases is its length. */
  durations: number[];
  children: ReactNode;
  className?: string;
  /** Optional accessible description of what the scene depicts. */
  label?: string;
}) {
  const last = durations.length - 1;
  const [phase, setPhase] = useState(last);
  const ref = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(last);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer = 0;
    let running = false;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = phaseRef.current >= last ? 0 : phaseRef.current + 1;
        phaseRef.current = next;
        setPhase(next);
        if (running) schedule();
      }, durations[phaseRef.current]);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        if (visible && !running) {
          running = true;
          schedule();
        } else if (!visible && running) {
          running = false;
          window.clearTimeout(timer);
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
    // `durations` is a literal array at every call site; its identity changing would
    // only restart the loop, which is harmless.
  }, [durations, last]);

  return (
    <div
      ref={ref}
      data-phase={phase}
      className={`mk-phase ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}
