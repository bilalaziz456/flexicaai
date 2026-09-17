"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * The homepage's scroll story: a patient's day in four steps, with the product screen
 * for the current step held in place beside the words while they scroll past.
 *
 * Desktop: the steps scroll, the artwork column is `sticky`, and whichever step sits
 * nearest the middle of the viewport is the active one — its artwork crossfades in,
 * the rail fills to it. Phone: there is no room to hold anything still, so each step
 * simply carries its own artwork inline beneath its words.
 *
 * Only the ACTIVE-STEP index is client state. The artwork itself is server-rendered
 * and handed in as props, so this component adds a scroll listener, not a bundle of
 * illustrations. The server render is step 1 active, which is a complete, correct
 * page without script.
 *
 * The inline (phone) and sticky (desktop) copies of each artwork both exist in the DOM,
 * one hidden by a breakpoint. `display: none` stops CSS animations, so the hidden copy
 * costs markup, not motion. Inactive desktop artwork is paused too (`motion-paused`),
 * so only the visible scene animates.
 */

export type TourStep = {
  label: string;
  title: string;
  body: string;
  points: string[];
  link: { href: string; label: string };
  visual: ReactNode;
};

export function ProductTour({ steps }: { steps: TourStep[] }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    // The active step is whichever block is nearest the middle of the viewport,
    // measured on each scroll frame. An IntersectionObserver on a thin middle band was
    // tried first and is wrong in a way that is easy to miss: a fast scroll or an
    // anchor jump can carry a step clean over the band between two callbacks, and the
    // stage is then left showing a scene the reader has already passed.
    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDistance = Infinity;
      items.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const distance = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      setActive(best);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const fill = steps.length > 1 ? (active / (steps.length - 1)) * 100 : 100;

  return (
    <div className="relative grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <ol className="relative">
        {/* Progress rail (desktop): a track, and the part already travelled. */}
        <span aria-hidden="true" className="absolute top-24 bottom-24 left-[19px] hidden w-px bg-[var(--mk-line-strong)] lg:block" />
        <span
          aria-hidden="true"
          className="absolute top-24 left-[19px] hidden w-px origin-top bg-gradient-to-b from-brand-teal to-brand-blue transition-[height] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block"
          style={{ height: `calc((100% - 12rem) * ${fill / 100})` }}
        />

        {steps.map((step, i) => {
          const on = i === active;
          return (
            <li
              key={step.label}
              ref={(el) => {
                items.current[i] = el;
              }}
              data-index={i}
              className="relative py-10 lg:flex lg:min-h-[78vh] lg:flex-col lg:justify-center lg:py-0 lg:pl-14"
            >
              <span
                aria-hidden="true"
                className={cn(
                  // Inline above the words on a phone, where an indent would squeeze the
                  // artwork; on the rail from lg up.
                  "mb-5 inline-flex size-10 items-center justify-center rounded-full font-mono text-xs font-semibold transition-all duration-500 lg:absolute lg:top-1/2 lg:left-0 lg:mb-0 lg:-translate-y-1/2",
                  on
                    ? "bg-brand-teal text-brand-navy shadow-[0_0_0_6px_color-mix(in_oklab,var(--brand-teal)_18%,transparent)]"
                    : "bg-card text-muted-foreground shadow-[0_0_0_1px_var(--mk-line-strong)]",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <div className={cn("transition-opacity duration-500", on ? "lg:opacity-100" : "lg:opacity-55")}>
                <p className="text-xs font-semibold tracking-[0.14em] text-primary-text uppercase">{step.label}</p>
                <h3 className="mt-3 text-[clamp(1.75rem,3.2vw,2.6rem)] leading-[1.06] font-bold tracking-[-0.035em] text-balance">
                  {step.title}
                </h3>
                <p className="mt-4 max-w-md text-[1.05rem] leading-relaxed text-muted-foreground">{step.body}</p>
                <ul className="mt-6 space-y-2.5">
                  {step.points.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-[0.95rem]">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/15 text-primary-text">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
                <Link
                  href={step.link.href}
                  className="group mt-7 inline-flex items-center gap-2 text-sm font-semibold text-foreground"
                >
                  <span className="mk-link">{step.link.label}</span>
                  <ArrowRight className="size-4 text-primary-text transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </div>

              {/* Phone: the artwork travels with its step. */}
              <div className="mt-10 lg:hidden">{step.visual}</div>
            </li>
          );
        })}
      </ol>

      {/* Desktop: one stage, held still, crossfading between steps. All scenes share
          one grid cell so the stage keeps the tallest scene's height and nothing
          jumps as they swap. */}
      <div className="hidden lg:block">
        <div className="sticky top-24 flex h-[calc(100vh-7rem)] items-center">
          <div className="relative grid w-full">
            <div
              aria-hidden="true"
              className="absolute -inset-10 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-teal/12 via-transparent to-brand-blue/12 blur-2xl"
            />
            {steps.map((step, i) => (
              <div
                key={step.label}
                aria-hidden={i !== active}
                className={cn(
                  "col-start-1 row-start-1 self-center transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  i === active
                    ? "opacity-100"
                    : cn(
                        "pointer-events-none opacity-0 blur-[2px] motion-paused",
                        i < active ? "-translate-y-8 scale-[0.97]" : "translate-y-8 scale-[0.97]",
                      ),
                )}
              >
                {step.visual}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
