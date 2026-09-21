"use client";

import { useEffect, useState } from "react";
import { cn } from "@/core/lib/utils";

export type RailSection = {
  /** Must match the `id` on the section element it points at. */
  id: string;
  label: string;
  /** Sections sharing a group are listed under one heading. */
  group?: string;
};

/**
 * A sticky index for a long page, with the current section marked.
 *
 * The patient record is twelve stacked cards and about 6,200px tall, so reaching the
 * odontogram means scrolling past the entire account, the details, the medical history
 * and every visit. The obvious fix is tabs — but this is a clinical record, and tabs
 * would hide four fifths of it behind a click, take it out of Ctrl+F, and take it off
 * the printed page. A rail makes the page navigable while leaving it whole.
 *
 * Desktop only, deliberately: an index beside the content needs width it does not have
 * on a phone, and below `lg` the page is simply the long scroll it always was. That is
 * a real limitation rather than a stub — a phone-sized version of this would be a
 * dropdown, which is a different control answering a different question.
 */
export function SectionRail({
  sections,
  className,
}: {
  sections: readonly RailSection[];
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  // A STABLE dependency for the effect. `sections` is a fresh array every render, so
  // depending on it would re-subscribe the scroll listener on each one; a ref written
  // during render (the other obvious fix) is what React forbids.
  const idKey = sections.map((s) => s.id).join("|");

  useEffect(() => {
    const ids = idKey.split("|");
    let frame = 0;

    /**
     * The section you are IN is the last one whose heading has passed the top of the
     * viewport — not the one most visible. With cards of wildly different heights (a
     * two-line "Account" above a full odontogram) "most visible" makes the rail skip
     * the short ones entirely, which is exactly when you most want it to be right.
     */
    const measure = () => {
      frame = 0;
      const threshold = 140;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - threshold <= 0) current = id;
      }
      // The final section can be too short to ever reach the threshold; at the bottom
      // of the page it is unambiguously the one you are looking at.
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 8;
      if (atBottom) current = ids.at(-1) ?? current;
      setActive(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    // Scheduled rather than called directly: setState in an effect BODY causes a
    // cascading render (and the lint rule that forbids it is right).
    frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [idKey]);

  // Group headings, in the order the sections were given.
  const groups: { name: string | null; items: RailSection[] }[] = [];
  for (const s of sections) {
    const name = s.group ?? null;
    const last = groups.at(-1);
    if (last && last.name === name) last.items.push(s);
    else groups.push({ name, items: [s] });
  }

  return (
    <nav
      aria-label="Sections"
      // `print:hidden` — an index of anchors is meaningless on paper.
      className={cn("sticky top-24 hidden max-h-[calc(100vh-8rem)] overflow-y-auto lg:block print:hidden", className)}
    >
      {groups.map((g) => (
        <div key={g.name ?? "_"} className="mb-4 last:mb-0">
          {g.name ? (
            <p className="mb-1.5 px-3 text-2xs font-semibold tracking-[0.07em] text-muted-foreground/70 uppercase">
              {g.name}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {g.items.map((s) => {
              const on = active === s.id;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "relative block rounded-lg py-1.5 pr-2 pl-3.5 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      on
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    {on ? (
                      <span
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    ) : null}
                    {s.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
