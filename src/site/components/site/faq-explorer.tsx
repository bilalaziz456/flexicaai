"use client";

import { ArrowLeft, ArrowRight, ChevronDown, MessageCircle, Quote } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { WHATSAPP_URL } from "../../lib/contact";
import { cx } from "../ui";

/**
 * The feature-page FAQ (the home page has its own accordion). On wide screens: a
 * question index on the left and a dark "answer stage" on the right that slides the
 * chosen answer in, with progress dots and previous / next. On phones: a compact
 * accordion. Every answer is always in the HTML (inactive ones are hidden, not
 * removed), so search engines and find-in-page still see them.
 */
export function FaqExplorer({ faqs, className }: { faqs: { q: string; a: string }[]; className?: string }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const total = faqs.length;
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  const go = (i: number) => setActive((i + total) % total);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + total) % total;
    go(next);
    document.getElementById(`${id}-q${next}`)?.focus();
  };

  return (
    <div className={cx("grid items-start gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10", className)}>
      {/* ── Question index (and, on phones, the accordion). */}
      <ol className="grid gap-2.5">
        {faqs.map(({ q, a }, i) => {
          const on = active === i;
          return (
            <li key={q}>
              <div
                className={cx(
                  "relative overflow-hidden rounded-2xl border transition-all duration-500",
                  on
                    ? "border-teal/40 bg-white shadow-[0_24px_50px_-30px_rgb(15_180_187/0.7)]"
                    : "border-transparent bg-white/60 hover:border-mist-300 hover:bg-white",
                )}
              >
                {/* Active bar. */}
                <span
                  className={cx(
                    "absolute inset-y-3 left-0 w-1 origin-center rounded-r-full bg-gradient-to-b from-teal-glow to-teal transition-transform duration-500",
                    on ? "scale-y-100" : "scale-y-0",
                  )}
                  aria-hidden
                />
                <h3>
                  <button
                    id={`${id}-q${i}`}
                    type="button"
                    aria-expanded={on}
                    aria-controls={`${id}-a${i}`}
                    onClick={() => go(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left"
                  >
                    <span
                      className={cx(
                        "grid size-9 shrink-0 place-items-center rounded-xl font-mono text-[11.5px] font-semibold transition-all duration-500",
                        on ? "bg-navy-900 text-teal-glow shadow-[0_0_0_5px_rgb(15_180_187/0.14)]" : "bg-mist text-ink-mute",
                      )}
                      aria-hidden
                    >
                      {pad(i)}
                    </span>
                    <span className={cx("flex-1 text-[1rem] font-semibold leading-snug tracking-[-0.01em] transition-colors", on ? "text-ink" : "text-ink-soft")}>
                      {q}
                    </span>
                    <ArrowRight
                      className={cx("hidden size-4 shrink-0 transition-all duration-500 lg:block", on ? "translate-x-0 text-teal-ink opacity-100" : "-translate-x-2 opacity-0")}
                      aria-hidden
                    />
                    <ChevronDown className={cx("size-4 shrink-0 text-teal-ink transition-transform duration-500 lg:hidden", on && "rotate-180")} aria-hidden />
                  </button>
                </h3>
                {/* Phones: the answer opens under its question. */}
                <div className={cx("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden", on ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 pl-[4.25rem] text-[0.96rem] leading-relaxed text-ink-soft">{a}</p>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Answer stage (wide screens). */}
      <div className="band-dark grain relative hidden overflow-hidden rounded-[1.75rem] p-8 lg:sticky lg:top-28 lg:block xl:p-10">
        <div className="orb -right-20 -top-20 size-64 bg-teal/30" aria-hidden />
        <div className="orb -bottom-24 -left-16 size-56 bg-sky-400/15" aria-hidden />

        <div className="relative flex items-center justify-between gap-4">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-teal-glow">
            Answer · {pad(active)} / {pad(total - 1)}
          </p>
          <div className="flex items-center gap-1.5" aria-hidden>
            {faqs.map((f, i) => (
              <span
                key={f.q}
                className={cx("h-1.5 rounded-full transition-all duration-500", i === active ? "w-6 bg-teal-glow" : "w-1.5 bg-white/20")}
              />
            ))}
          </div>
        </div>

        {/* Every answer is here; the chosen one slides in. */}
        <div className="relative mt-8 grid">
          {faqs.map(({ q, a }, i) => {
            const on = i === active;
            return (
              <div
                key={q}
                id={`${id}-a${i}`}
                aria-hidden={!on}
                className={cx(
                  "[grid-area:1/1] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  on ? "visible translate-y-0 opacity-100" : "invisible translate-y-4 opacity-0",
                )}
              >
                <Quote className="size-9 text-teal/50" aria-hidden />
                <p className="mt-4 text-[1.35rem] font-semibold leading-snug tracking-[-0.015em] text-white">{q}</p>
                <p className="mt-5 text-[1.05rem] leading-relaxed text-slate-300">{a}</p>
              </div>
            );
          })}
        </div>

        <div className="relative mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => go(active - 1)}
              className="grid size-10 place-items-center rounded-full border border-white/15 text-white transition hover:border-teal hover:bg-teal/20"
              aria-label="Previous question"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              className="grid size-10 place-items-center rounded-full bg-teal text-white transition hover:bg-teal-glow hover:text-navy-900"
              aria-label="Next question"
            >
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[0.92rem] font-semibold text-teal-glow transition hover:text-white"
          >
            <MessageCircle className="size-4" aria-hidden /> Still unsure? Ask us on WhatsApp
          </a>
        </div>
      </div>

      {/* Phones: the WhatsApp nudge under the list. */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="band-dark flex items-center justify-between gap-3 rounded-2xl px-5 py-4 text-[0.95rem] font-semibold text-white lg:hidden"
      >
        <span className="flex items-center gap-2.5">
          <MessageCircle className="size-5 text-teal-glow" aria-hidden /> Still unsure? Ask us on WhatsApp
        </span>
        <ArrowRight className="size-4 text-teal-glow" aria-hidden />
      </a>
    </div>
  );
}
