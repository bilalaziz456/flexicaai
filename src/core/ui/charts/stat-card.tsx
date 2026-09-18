import { ArrowDown, ArrowUp, Sparkle } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/core/ui/card";
import { Sparkline } from "@/core/ui/sparkline";
import { InteractiveSparkline } from "@/core/ui/charts/sparkline-interactive";
import { percentChange } from "@/core/ui/charts/geometry";
import type { Insight } from "@/core/ui/charts/insights";
import { cn } from "@/core/lib/utils";

/**
 * The KPI card — one figure, what it is, which way it is going, and the shape that
 * got it there. The unit the whole analytics surface is built from, so a number means
 * the same thing and sits in the same place on every page.
 *
 * Everything past the value is OPTIONAL and omitted when the data is not there: no
 * trend array, no sparkline; no baseline, no delta. That is the important property.
 * Most figures in this app have no history behind them yet (a day book is one day, a
 * receivable is a balance), and a card that draws a flat line or an invented
 * percentage to keep its neighbours company is lying to make a grid look tidy.
 *
 * Server component: the sparkline is static SVG, so a page of these adds no client
 * JavaScript at all.
 */
export function StatCard({
  label,
  value,
  hint,
  trend,
  trendLabels,
  current,
  previous,
  higherIsBetter = true,
  comparisonLabel = "vs previous period",
  insight,
  tone = "default",
  action,
  className,
}: {
  label: string;
  value: string;
  /** A second line under the value — a count, a date, a denominator. */
  hint?: ReactNode;
  /** The series behind the figure. Omit when there is none. */
  trend?: number[];
  /** One per trend point. Supplying them makes the sparkline INTERACTIVE — the
   *  point under the pointer reads out above the trace. Without labels there is
   *  nothing to say about the point you are on, so it stays static (and free of
   *  client JavaScript). */
  trendLabels?: string[];
  /** Pass both to get a delta. Omit `previous` (or pass 0) and none is shown. */
  current?: number;
  previous?: number;
  /**
   * `"neutral"` for a figure that genuinely has no good or bad direction — the doctor
   * share bill rises WITH revenue, so scoring it green for going up put it beside an
   * expense line scored red for doing the same thing, on the same page, both printed
   * as money out. The movement is still shown; it is just not applauded.
   */
  higherIsBetter?: boolean | "neutral";
  comparisonLabel?: string;
  insight?: Insight | null;
  tone?: "default" | "good" | "bad";
  action?: ReactNode;
  className?: string;
}) {
  const pct =
    current != null && previous != null ? percentChange(current, previous) : null;
  const up = pct != null && pct > 0;
  const scored = higherIsBetter !== "neutral";
  const good = pct != null && scored && (pct === 0 ? true : up === higherIsBetter);
  const Arrow = up ? ArrowUp : ArrowDown;

  const hasSignal = Boolean(trend && trend.length > 1 && trend.some((v) => v !== 0));

  /**
   * The DELTA decides the trace, and it outranks `tone`. Net profit is the case that
   * proved it: the figure is positive so the card is toned "good" and the number is
   * green — but profit had fallen 95%, so the badge beside it was red while the
   * sparkline under it stayed green. `tone` is a fact about the LEVEL (we are in
   * profit); the badge and the trace both describe the MOVEMENT, and they have to
   * agree with each other or the card argues with itself.
   */
  const sparkColor =
    pct != null && scored
      ? good
        ? "var(--color-success)"
        : "var(--color-destructive)"
      : tone === "good" && pct == null
        ? "var(--color-success)"
        : tone === "bad" && pct == null
          ? "var(--color-destructive)"
          : "var(--color-chart-1)";

  return (
    <Card
      className={cn(
        "relative gap-0 overflow-hidden p-4",
        tone === "good" && "border-success/30",
        tone === "bad" && "border-destructive/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {action}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "text-2xl leading-none font-semibold tabular-nums",
            tone === "good" && "text-success-text",
            tone === "bad" && "text-destructive-text",
          )}
        >
          {value}
        </span>
        {pct != null && Math.abs(pct) >= 0.05 ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
              !scored
                ? "bg-muted text-muted-foreground"
                : good
                  ? "bg-success/10 text-success-text"
                  : "bg-destructive/10 text-destructive-text",
            )}
          >
            <Arrow className="size-3" aria-hidden="true" />
            {Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
            <span className="sr-only">
              {up ? "up" : "down"} {comparisonLabel}
            </span>
          </span>
        ) : null}
      </div>

      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      {pct != null ? (
        <p className="mt-0.5 text-2xs text-muted-foreground">{comparisonLabel}</p>
      ) : null}

      {/* A series of nothing but zeroes gets NO sparkline. It passes every other
          test — it is a real array, of real length, from a real query — and it draws
          a confident flat line that says "measured, and steady" when the truth is
          "nothing happened in this period". An all-zero period should look empty.
          A flat NON-zero series is kept: that is a genuine finding. */}
      {hasSignal ? (
        <div className="mt-3 -mb-1">
          {/* The trace takes the SAME judgement as the badge above it. Colouring it by
              the series' own direction — the tempting default — put a red sparkline
              under a green profit figure (the period ended lower than it started, but
              the business was still in profit), and a green one under RISING expenses,
              where up is the bad direction. A card must not argue with itself. */}
          {trendLabels && trendLabels.length === trend!.length ? (
            <InteractiveSparkline
              values={trend!}
              labels={trendLabels}
              height={28}
              color={sparkColor}
              ariaLabel={`${label} trend`}
            />
          ) : (
            <Sparkline
              values={trend!}
              height={28}
              color={sparkColor}
              ariaLabel={`${label} trend`}
            />
          )}
        </div>
      ) : null}

      {insight ? <InsightLine insight={insight} className="mt-3" /> : null}
    </Card>
  );
}

/**
 * The observation line. The ✦ marks it as derived rather than entered — it is
 * computed from the same series the card draws (`core/ui/charts/insights.ts`), which
 * is why it is labelled an insight and never "AI": the text is arithmetic, and
 * dressing arithmetic up as a model's judgement is how a clinic ends up trusting a
 * sentence more than the number above it.
 */
export function InsightLine({
  insight,
  className,
}: {
  insight: Insight;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg bg-muted/50 px-2 py-1.5 text-xs",
        insight.tone === "good" && "text-success-text",
        insight.tone === "bad" && "text-destructive-text",
        insight.tone === "neutral" && "text-muted-foreground",
        className,
      )}
    >
      <Sparkle className="mt-px size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{insight.text}</span>
    </p>
  );
}
