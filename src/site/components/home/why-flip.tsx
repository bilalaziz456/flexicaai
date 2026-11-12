"use client";

import {
  CalendarDays,
  Check,
  ChartColumnIncreasing,
  HeartPulse,
  KeyRound,
  MessageCircle,
  Mic,
  Receipt,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../ui";

export type WhyRow = { before: string; after: string };

const ICONS: LucideIcon[] = [UserRound, CalendarDays, MessageCircle, Mic, HeartPulse, Receipt, ChartColumnIncreasing, KeyRound];

/**
 * "Why FlexicaAI" as a transformation: eight cards that start as the old way of
 * working (paper, crossed out) and flip — one after another — into what FlexicaAI does
 * instead, when the section scrolls into view. A switch flips them back and forth.
 *
 * The visual cards are aria-hidden; the same content is in a plain list for screen
 * readers. Reduced motion: the flip is instant (the site-wide rule shortens transitions).
 */
export function WhyFlip({ rows }: { rows: WhyRow[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const touched = useRef(false);

  // Flip to "With FlexicaAI" once, shortly after the cards come into view.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !touched.current) {
          t = setTimeout(() => !touched.current && setOn(true), 500);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, []);

  const set = (v: boolean) => {
    touched.current = true;
    setOn(v);
  };

  return (
    <div ref={box}>
      {/* The switch */}
      <div className="mt-12 flex justify-center">
        <div role="group" aria-label="Compare" className="relative grid grid-cols-2 rounded-full bg-white p-1.5 shadow-[0_10px_30px_-15px_rgb(8_41_87/0.4)] ring-1 ring-mist-200">
          <span
            className={cx(
              "absolute inset-y-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              on ? "translate-x-full bg-navy-900 shadow-[0_8px_24px_-8px_rgb(15_180_187/0.7)]" : "translate-x-0 bg-mist-200",
            )}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => set(false)}
            aria-pressed={!on}
            className={cx("relative z-10 rounded-full px-4 py-2.5 text-[0.85rem] font-semibold transition-colors sm:px-6", on ? "text-ink-mute hover:text-ink" : "text-ink")}
          >
            Without a connected system
          </button>
          <button
            type="button"
            onClick={() => set(true)}
            aria-pressed={on}
            className={cx("relative z-10 rounded-full px-4 py-2.5 text-[0.85rem] font-semibold transition-colors sm:px-6", on ? "text-teal-glow" : "text-ink-mute hover:text-ink")}
          >
            With FlexicaAI
          </button>
        </div>
      </div>

      {/* The cards */}
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {rows.map((r, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <li key={r.after} className="group h-[15.5rem] [perspective:1200px]">
              <div
                className={cx(
                  "relative size-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d] group-hover:-translate-y-1",
                  on && "[transform:rotateY(180deg)]",
                )}
                style={{ transitionDelay: `${(on ? i : rows.length - 1 - i) * 90}ms` }}
              >
                {/* Before: paper, crossed out */}
                <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[1.6rem] border border-mist-300 bg-[#f7f9fb] p-6 [backface-visibility:hidden]">
                  <div
                    className="pointer-events-none absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(0deg,transparent_0_27px,rgb(8_41_87/0.07)_27px_28px)]"
                    aria-hidden
                  />
                  <div className="relative flex items-center justify-between">
                    <span className="relative grid size-11 place-items-center rounded-2xl bg-mist-200 text-ink-mute">
                      <Icon className="size-5" strokeWidth={1.8} />
                      <span className="absolute h-0.5 w-8 rotate-[-35deg] rounded-full bg-ink-mute/60" />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute/80">Before</span>
                  </div>
                  <p className="relative mt-auto text-[1.02rem] font-medium leading-snug text-ink-soft">{r.before}</p>
                </div>

                {/* After: lit, with FlexicaAI */}
                <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[1.6rem] bg-[linear-gradient(150deg,#0b3d6b,#061c3b_55%,#04152e)] p-6 shadow-[0_30px_60px_-30px_rgb(15_180_187/0.55)] ring-1 ring-teal/30 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-teal/25 blur-3xl" aria-hidden />
                  <div
                    className={cx(
                      "pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-[1400ms] ease-out",
                      on ? "translate-x-[400%]" : "translate-x-0",
                    )}
                    style={{ transitionDelay: `${i * 90 + 500}ms` }}
                    aria-hidden
                  />
                  <div className="relative flex items-center justify-between">
                    <span className="icon-tile grid size-11 place-items-center rounded-2xl">
                      <Icon className="size-5" strokeWidth={1.9} />
                    </span>
                    <span className="grid size-7 place-items-center rounded-full bg-teal text-navy-900">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  </div>
                  <p className="relative mt-auto text-[1.02rem] font-semibold leading-snug text-white">{r.after}</p>
                  <p className="relative mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-teal-glow">With FlexicaAI</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* The same content, for screen readers */}
      <ul className="sr-only">
        {rows.map((r) => (
          <li key={r.after}>
            Without a connected system: {r.before}. With FlexicaAI: {r.after}.
          </li>
        ))}
      </ul>
    </div>
  );
}
