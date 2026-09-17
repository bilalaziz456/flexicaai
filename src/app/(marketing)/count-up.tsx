"use client";

import { useEffect, useRef } from "react";

/**
 * A figure that counts up from zero the first time it scrolls into view.
 *
 * The server renders the FINAL value, so the number is correct in the prerendered
 * HTML, to a crawler, without script, and under reduced motion. The count only
 * replaces that text once, from an observer, and writes the DOM directly rather than
 * through React state — sixty re-renders a second to animate a label would cost more
 * than the effect is worth.
 *
 * Grouping is Pakistani (en-IN: 3,84,200), because these are rupee figures and that
 * is how the people reading them write rupees.
 */
export function CountUp({
  value,
  prefix = "",
  duration = 1400,
  delay = 0,
  className,
}: {
  value: number;
  prefix?: string;
  duration?: number;
  /** Milliseconds to wait after the figure comes into view. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const format = (n: number) => `${prefix}${Math.round(n).toLocaleString("en-IN")}`;
    let frame = 0;
    let timer = 0;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          const start = performance.now();
          const tick = (now: number) => {
            // Zeroed on the first frame, not before it: if frames never run (a
            // background tab), the figure keeps its final value instead of sitting at 0.
            const p = Math.min(1, (now - start) / duration);
            // Ease-out quart: fast at first, settling onto the figure.
            el.textContent = format(value * (1 - Math.pow(1 - p, 4)));
            if (p < 1) frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        }, delay);
      },
      { threshold: 0.6 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      el.textContent = format(value);
    };
  }, [value, prefix, duration, delay]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {prefix}
      {value.toLocaleString("en-IN")}
    </span>
  );
}
