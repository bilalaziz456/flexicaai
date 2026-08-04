import { BadgeCheck, CalendarCheck } from "lucide-react";

/**
 * Where a month's figures come from: one completed visit at the top, and every number
 * below it derived from that same record rather than entered again somewhere else.
 *
 * This exists because the section's claim is derivation, and derivation is a
 * relationship — you cannot assert it in a sentence and be believed. So the visual
 * literally subtracts down to a net figure from a single source, and the connecting
 * line grows into the rows as they arrive.
 *
 * The numbers are illustrative but they ADD UP: 13,900 − 4,170 − 1,800 = 7,930. A
 * panel making the argument "these reconcile" with figures that do not reconcile
 * would undo the point at a glance, and someone always checks.
 *
 * Reuses the 9s `audit-in` and `total-settle` keyframes so the rows, the line and the
 * net land in order and cannot drift apart.
 */

const DERIVED = [
  { label: "Collected", note: "Money actually taken", value: "13,900", tone: "text-foreground/80" },
  { label: "Provider share", note: "Owed to Dr. Sana", value: "−4,170", tone: "text-muted-foreground" },
  { label: "Operating costs", note: "Rent, salaries, supplies", value: "−1,800", tone: "text-muted-foreground" },
];

export function DerivationVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          Where the numbers come from
        </p>

        {/* The single source. Always present — it is the record your team already made. */}
        <div className="mt-4 flex items-start gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <CalendarCheck className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Visit completed</span>
            <span className="block font-mono text-[11px] text-muted-foreground">
              4 Aug · Dr. Sana · 3 items
            </span>
          </span>
        </div>

        {/* Everything below hangs off that one record. */}
        <div className="relative mt-3 pl-4">
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-8 left-[15px] w-px bg-gradient-to-b from-primary/60 to-primary/10 motion-safe:animate-trace-grow"
          />

          <ul className="space-y-2.5">
            {DERIVED.map(({ label, note, value, tone }, i) => (
              <li
                key={label}
                style={{ animationDelay: `${(1.2 + i * 0.9).toFixed(1)}s` }}
                className="flex items-baseline gap-3 pl-6 motion-safe:animate-audit-in"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-[12.5px] ${tone}`}>{label}</span>
                  <span className="block font-mono text-[10.5px] text-muted-foreground">
                    {note}
                  </span>
                </span>
                <span className="font-mono text-[13px] tabular-nums">{value}</span>
              </li>
            ))}
          </ul>

          {/* The net only appears once the three above it have. */}
          <div
            style={{ animationDelay: "0s" }}
            className="mt-4 ml-6 flex items-baseline justify-between border-t border-foreground/10 pt-3.5 motion-safe:animate-total-settle"
          >
            <span className="text-[12px] text-muted-foreground">Net for the visit</span>
            <span className="font-mono text-lg font-medium text-primary tabular-nums">
              7,930
            </span>
          </div>
        </div>

        <p className="mt-5 flex items-start gap-2.5 border-t border-foreground/10 pt-4 text-[12px] leading-snug text-muted-foreground">
          <BadgeCheck className="mt-px size-4 shrink-0 text-primary" />
          <span>
            <span className="font-medium text-foreground/80">Nothing was typed twice.</span>{" "}
            Change the visit and every figure here moves with it.
          </span>
        </p>
      </div>
    </div>
  );
}
