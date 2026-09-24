import type { CSSProperties } from "react";
import { ArrowUpRight, BarChart3, Banknote, Clock3, Wallet } from "lucide-react";
import { CountUp } from "./count-up";
import { RevenueChart } from "./revenue-chart";

/**
 * The billing hero's right-hand composition, in the homepage hero's language: the
 * collected-vs-billed chart as the product surface, with three moments floating around
 * it — the headline figure, a payment landing, and something that needs attention.
 * The full finance dashboard is the section below; this is the glance.
 *
 * No AI is implied: the flag is receivables arithmetic, which is what the product does.
 * Sample figures; real INV/RCP number formats. The chart is interactive (hover or arrow
 * keys), so this wrapper is NOT aria-hidden — the chart carries its own description.
 */

const TREND = [
  { label: "Jul 7", billed: 312000, collected: 268000 },
  { label: "Jul 21", billed: 341000, collected: 289000 },
  { label: "Aug 4", billed: 355000, collected: 312000 },
  { label: "Aug 18", billed: 372000, collected: 331000 },
  { label: "Sep 1", billed: 389000, collected: 352000 },
  { label: "Sep 8", billed: 401000, collected: 368000 },
  { label: "Sep 15", billed: 412000, collected: 384200 },
];

const rise = (ms: number) => ({ "--mk-delay": `${ms}ms` }) as CSSProperties;

export function FinanceHeroArt() {
  return (
    <div className="relative text-left select-none sm:pt-28 sm:pb-24">
      {/* ---- floating: the headline figure ---- */}
      <div className="hero-depth-3 relative mb-4 sm:absolute sm:top-0 sm:-left-4 sm:z-10 sm:mb-0 sm:w-64 lg:-left-10">
        <div aria-hidden="true" className="mk-rise relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-[#0b3a6e] to-brand-blue p-5 text-white shadow-[var(--mk-shadow-lift)]" style={rise(500)}>
          <div className="absolute -top-12 -right-10 -z-10 size-36 rounded-full bg-brand-teal/40 blur-3xl" />
          <p className="flex items-center gap-2 text-xs font-medium text-white/75">
            <Wallet className="size-3.5" /> Collected · last 30 days
          </p>
          <p className="mt-2 text-3xl font-bold tracking-[-0.04em]">
            <CountUp value={1428500} prefix="Rs " delay={500} />
          </p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-2xs font-semibold text-[#8ff0c0]">
            <ArrowUpRight className="size-3" /> 12% vs previous 30 days
          </p>
        </div>
      </div>

      {/* ---- the chart ---- */}
      <div className="hero-depth-2">
        <div className="mk-frame rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="size-4 text-primary-text" /> Collected vs billed
            </p>
            <span className="flex items-center gap-3 text-2xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 rounded-full bg-gradient-to-r from-brand-blue to-brand-teal" /> Collected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 rounded-full bg-foreground/30" /> Billed
              </span>
            </span>
          </div>
          <div className="mt-4 text-foreground">
            <RevenueChart data={TREND} />
          </div>
        </div>
      </div>

      {/* ---- floating: a payment landing ---- */}
      <div className="hero-depth-1 relative mt-4 sm:absolute sm:top-8 sm:-right-3 sm:mt-0 sm:w-56 lg:-right-8">
        <div aria-hidden="true" className="mk-rise mk-card flex items-center gap-3 rounded-2xl p-3.5" style={rise(900)}>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/12 text-success-text">
            <Banknote className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold">Rs 10,000 received</span>
            <span className="block truncate font-mono text-3xs text-muted-foreground">RCP-2026-0000213 · Bank</span>
          </span>
        </div>
      </div>

      {/* ---- floating: what needs attention ---- */}
      <div className="hero-depth-3 relative mt-4 sm:absolute sm:right-6 sm:bottom-0 sm:mt-0 sm:w-64 lg:-right-4">
        <div aria-hidden="true" className="mk-rise mk-card rounded-2xl p-4" style={rise(1200)}>
          <div className="flex gap-3">
            <span className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning-text">
              <Clock3 className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning motion-safe:animate-pulse" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">Rs 176,500 still owed</span>
              <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">9 patients · 3 for more than 30 days</span>
              <span className="mt-1.5 inline-flex items-center gap-1 text-2xs font-semibold text-primary-text">
                Open receivables <ArrowUpRight className="size-3" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
