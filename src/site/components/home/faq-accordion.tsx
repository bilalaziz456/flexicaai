"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "../ui";

/**
 * The home FAQ: numbered cards, one open at a time. The open card turns navy and its
 * answer slides open (a 0fr → 1fr grid row, so the height animates without measuring).
 * Every answer is always in the HTML — closed ones are clipped, not removed — so search
 * engines and find-in-page still see them.
 */
export function FaqAccordion({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  const id = useId();

  return (
    <div className="relative">
      {/* Progress rail: how far down the list the open question is. */}
      <div className="absolute bottom-4 left-[1.45rem] top-4 hidden w-px bg-mist-200 sm:block" aria-hidden>
        <div
          className="w-full bg-gradient-to-b from-teal-glow to-teal transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ height: `${((open < 0 ? 0 : open + 1) / faqs.length) * 100}%` }}
        />
      </div>
      <ol className="relative grid gap-3">
        {faqs.map(({ q, a }, i) => {
          const isOpen = open === i;
          const panel = `${id}-a${i}`;
          return (
            <li key={q} className="relative sm:pl-14">
              <span
                className={cx(
                  "absolute left-0 top-5 hidden size-[2.9rem] place-items-center rounded-full font-mono text-[12px] font-semibold transition-all duration-500 sm:grid",
                  isOpen ? "bg-navy-900 text-teal-glow shadow-[0_0_0_6px_rgb(15_180_187/0.15)]" : "bg-white text-ink-mute ring-1 ring-mist-300",
                )}
                aria-hidden
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div
                className={cx(
                  "spot overflow-hidden rounded-[1.4rem] transition-[background,box-shadow,border-color] duration-500",
                  isOpen
                    ? "border border-teal/30 bg-[linear-gradient(150deg,#0b3d6b,#061c3b_60%,#04152e)] shadow-[0_30px_60px_-30px_rgb(15_180_187/0.6)]"
                    : "border border-mist-200 bg-white hover:border-teal/40",
                )}
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left sm:px-7"
                  >
                    <span className={cx("text-[1.06rem] font-semibold tracking-[-0.01em] transition-colors", isOpen ? "text-white" : "text-ink")}>{q}</span>
                    <span
                      className={cx(
                        "grid size-9 shrink-0 place-items-center rounded-full transition-all duration-500",
                        isOpen ? "rotate-[135deg] bg-teal text-navy-900" : "bg-mist text-teal-ink ring-1 ring-mist-300",
                      )}
                      aria-hidden
                    >
                      <Plus className="size-4" strokeWidth={2.5} />
                    </span>
                  </button>
                </h3>
                <div
                  id={panel}
                  role="region"
                  aria-label={q}
                  className={cx("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
                >
                  <div className="overflow-hidden">
                    <p
                      className={cx(
                        "px-6 pb-6 pr-16 text-[1rem] leading-relaxed transition-all duration-500 sm:px-7",
                        isOpen ? "translate-y-0 text-slate-300 opacity-100 delay-150" : "-translate-y-2 text-ink-soft opacity-0",
                      )}
                    >
                      {a}
                    </p>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
