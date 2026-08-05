import { BadgeCheck, TrendingUp } from "lucide-react";

/**
 * Two panels: a bill whose discount needs signing off before it counts, and the
 * revenue that results.
 *
 * The approval step is the argument. Plenty of software lets a receptionist type a
 * discount; the claim worth making is that until someone with the authority approves
 * it, the bill and the revenue figure both behave as if it were zero. So the line
 * items sit there unchanged while the STATUS flips and the total settles to a
 * different number — nothing is revealed, something is decided.
 *
 * The bars are the one thing that grows, because a bar being measured is what growth
 * looks like; they scale from the axis, not the centre.
 *
 * Server-rendered, CSS keyframes only, all on one 9s loop.
 */

const LINES = [
  { name: "Consultation", qty: 1, amount: "3,000" },
  { name: "Procedure A", qty: 1, amount: "8,500" },
  { name: "Procedure B", qty: 2, amount: "4,400" },
];

/** Bar heights as a percentage. Illustrative shape, not a claim about anyone's books. */
const BARS = [38, 52, 45, 66, 58, 79, 71, 92];

export function BillingVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      {/* ---- the bill ---- */}
      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
            Invoice
          </p>
          {/* Two statuses on one spot, exact complements, so one is always readable. */}
          <span className="relative inline-flex h-6 items-center">
            {/* amber-800, not -700: on this chip's own amber tint -700 measured 4.47:1,
                a hair under AA at 10px. The dark override is unchanged. */}
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-3xs font-medium tracking-wide text-amber-800 uppercase opacity-0 ring-1 ring-amber-500/30 motion-safe:animate-note-draft dark:text-amber-400">
              Discount pending
            </span>
            <span className="absolute inset-y-0 right-0 inline-flex items-center rounded-full bg-whatsapp/15 px-2.5 text-3xs font-medium tracking-wide text-whatsapp-fg uppercase ring-1 ring-whatsapp/40 motion-safe:animate-note-approved">
              Approved
            </span>
          </span>
        </div>

        <dl className="mt-4 space-y-2">
          {LINES.map((l) => (
            <div key={l.name} className="flex items-baseline gap-3 text-sm">
              <dt className="flex-1 text-foreground/80">
                {l.name}
                {l.qty > 1 ? (
                  <span className="ml-1.5 text-muted-foreground">×{l.qty}</span>
                ) : null}
              </dt>
              <dd className="font-mono text-muted-foreground tabular-nums">{l.amount}</dd>
            </div>
          ))}
          <div className="flex items-baseline gap-3 text-sm">
            <dt className="flex-1 text-amber-700 dark:text-amber-400">Discount</dt>
            <dd className="font-mono text-amber-700 tabular-nums dark:text-amber-400">
              −2,000
            </dd>
          </div>
        </dl>

        {/* The figure settles only once the status has flipped. */}
        <div className="mt-4 flex items-baseline justify-between border-t border-foreground/10 pt-3.5">
          <span className="text-xs text-muted-foreground">Total due</span>
          <span className="relative inline-flex h-7 items-baseline">
            <span className="font-mono text-lg font-medium tabular-nums opacity-0 motion-safe:animate-note-draft">
              15,900
            </span>
            <span className="absolute inset-y-0 right-0 inline-flex items-baseline font-mono text-lg font-medium text-primary-text tabular-nums motion-safe:animate-total-settle">
              13,900
            </span>
          </span>
        </div>
      </div>

      {/* ---- what it adds up to ---- */}
      <div className="mt-4 rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
            Revenue
          </p>
          <span className="inline-flex items-center gap-1.5 text-2xs text-whatsapp-fg">
            <TrendingUp className="size-3.5" />
            Collected, not invoiced
          </span>
        </div>

        <div className="mt-4 flex h-24 items-end gap-2">
          {BARS.map((h, i) => (
            <span
              key={i}
              style={{ height: `${h}%`, animationDelay: `${(i * 0.09).toFixed(2)}s` }}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-brand-blue/40 to-brand-teal motion-safe:animate-bar-grow"
            />
          ))}
        </div>

        <p className="mt-4 flex items-center gap-2 border-t border-foreground/10 pt-3.5 text-xs text-muted-foreground">
          <BadgeCheck className="size-4 shrink-0 text-primary-text" />
          Every figure traces back to a visit your team already recorded.
        </p>
      </div>
    </div>
  );
}
