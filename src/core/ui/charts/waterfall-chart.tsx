"use client";

import { useState } from "react";
import { ChartEmpty, Grid, PAD, useChartWidth } from "@/core/ui/charts/chart-kit";
import { money as fmtMoney, niceScale, shortNum } from "@/core/ui/charts/geometry";

/** A waterfall step. `role`: start = anchored bar from 0 (Collected); deduct = a
 *  descending step (value is signed, usually negative); result = the anchored total
 *  (Net profit, coloured by sign). `color` overrides the role's default fill. */
export type WaterfallStep = {
  label: string;
  value: number;
  role: "start" | "deduct" | "result";
  color?: string;
};

/**
 * WATERFALL — how one total became another: collected → −doctor shares → −expenses →
 * net profit. Anchored totals stand on the zero baseline, deductions float between the
 * running levels, and a connector carries the eye from each bar to the next.
 *
 * This is the one place bars are the RIGHT answer, which is why the redesign kept
 * them. A line implies the in-between is continuous — that the clinic passed through
 * some value on the way from revenue to profit — and it did not; these are four
 * discrete quantities in a sequence. What a waterfall shows that four separate figures
 * cannot is that they are the SAME money, being spent down.
 *
 * Moved into the chart system so it shares the grid, the scale and the tooltip with
 * everything else; it used to carry its own copies of all three.
 */
export function WaterfallChart({
  steps,
  height = 260,
  formatValue = fmtMoney,
  ariaLabel = "Money flow",
}: {
  steps: WaterfallStep[];
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel?: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  // Each bar's span: a deduction hangs from the running total before it; a total is
  // anchored at zero.
  const bars = steps.map((s, i, arr) => {
    const running = arr
      .slice(0, i)
      .reduce((r, p) => (p.role === "deduct" ? r + p.value : p.value), 0);
    return s.role === "deduct"
      ? { ...s, from: running, to: running + s.value }
      : { ...s, from: 0, to: s.value };
  });

  if (bars.length === 0) return <ChartEmpty message="Nothing to show yet." height={height} />;

  const allY = bars.flatMap((b) => [b.from, b.to]).concat(0);
  const scale = niceScale(Math.min(...allY), Math.max(...allY));
  const span = scale.max - scale.min || 1;

  const n = bars.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + plotH * (1 - (v - scale.min) / span);
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(1, Math.min(slot * 0.54, 84));

  const colorFor = (b: (typeof bars)[number]) =>
    b.color ??
    (b.role === "start"
      ? "var(--color-chart-1)"
      : b.role === "result"
        ? b.value < 0
          ? "var(--color-destructive)"
          : "var(--color-success)"
        : "var(--color-chart-4)");

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setActive(null)}
        >
          <Grid ticks={scale.ticks} yFor={yFor} width={width} format={shortNum} zero={0} />

          {bars.map((b, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const yTop = yFor(Math.max(b.from, b.to));
            const yBot = yFor(Math.min(b.from, b.to));
            const h = Math.max(1, yBot - yTop);
            const dim = active != null && active !== i;
            return (
              <g
                key={`${b.label}-${i}`}
                opacity={dim ? 0.45 : 1}
                className="transition-opacity"
                onPointerEnter={() => setActive(i)}
              >
                {/* The connector runs at this bar's finishing level to where the next
                    one begins — the thread that makes four bars one story. */}
                {i < n - 1 ? (
                  <line
                    x1={x + barW}
                    x2={PAD.left + slot * (i + 1) + (slot - barW) / 2}
                    y1={yFor(b.to)}
                    y2={yFor(b.to)}
                    className="stroke-muted-foreground/35"
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />
                ) : null}
                <rect
                  x={x}
                  y={yTop}
                  width={barW}
                  height={h}
                  rx={5}
                  fill={colorFor(b)}
                  className="chart-fade-in"
                />
                {/* The figure sits ON the bar, so the eye never travels to an axis to
                    read a number that only has four values. */}
                <text
                  x={x + barW / 2}
                  y={yTop - 7}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-semibold tabular-nums"
                >
                  {shortNum(b.value)}
                </text>
                <text
                  x={x + barW / 2}
                  y={PAD.top + plotH + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {b.label}
                </text>
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      )}

      {active != null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(
              Math.max(PAD.left + slot * active + slot / 2, 90),
              Math.max(width - 90, 90),
            ),
          }}
          role="status"
        >
          <div className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {bars[active].label}
          </div>
          <div className="mt-0.5 text-sm font-medium tabular-nums">
            {formatValue(bars[active].value)}
          </div>
          {bars[active].role === "deduct" ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              Leaves {formatValue(bars[active].to)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
