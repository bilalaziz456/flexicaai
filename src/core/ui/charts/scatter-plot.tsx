"use client";

import { useState } from "react";
import { ChartEmpty, Grid, PAD, useChartWidth } from "@/core/ui/charts/chart-kit";
import { money as fmtMoney, niceScale, shortNum } from "@/core/ui/charts/geometry";

/**
 * Axis units are named, not passed as functions.
 *
 * This is a client component and its callers are SERVER pages, and a function
 * cannot cross that boundary — Next refuses the render outright, which is how the
 * no-show report came back as "Something went wrong" rather than a chart. A token
 * serialises, and it also stops two axes of different units sharing one formatter
 * and printing a count of twenty visits as "20.0%".
 */
export type AxisFormat = "money" | "percent" | "count";

const FORMATTERS: Record<AxisFormat, (v: number) => string> = {
  money: fmtMoney,
  percent: (v) => `${v.toFixed(1)}%`,
  count: (v) => Math.round(v).toLocaleString("en-PK"),
};

export type ScatterPoint = {
  label: string;
  x: number;
  y: number;
  /** Optional third measure, encoded as the dot's size. */
  weight?: number;
};

/**
 * CORRELATION — two measures against each other, one dot per thing: what a clinic
 * pays us against what it costs us to serve.
 *
 * This replaced a TABLE whose own description said "spot a clinic that costs more
 * than it pays". That is a question about a RELATIONSHIP, and a table answers it by
 * making you subtract twenty pairs of numbers in your head. Here it is a position: the
 * break-even diagonal is drawn, and anything below it costs more than it earns. One
 * glance, no arithmetic.
 *
 * The diagonal is the point of the chart, so both axes share ONE scale — a clinic
 * cannot look profitable because its axis happens to be stretched differently.
 */
export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  height = 280,
  xFormat = "money",
  yFormat = "money",
  breakEven = false,
  refLine,
  goodSide = "below",
  emptyMessage = "Nothing to compare in this period yet.",
  ariaLabel,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height?: number;
  /** How each axis reads. They are often different units. */
  xFormat?: AxisFormat;
  yFormat?: AxisFormat;
  /** Draw the y = x line — only meaningful when both axes are the same unit. */
  breakEven?: boolean;
  /** A horizontal reference — the house average, a target — for the common case
   *  where the two axes are DIFFERENT units and no diagonal is meaningful. */
  refLine?: { value: number; label: string };
  /** Which side of the diagonal the HEALTHY dots sit on, ON SCREEN. For revenue
   *  against cost that is "below": a clinic whose cost is small next to what it pays
   *  sits low on the y axis and therefore under the line. */
  goodSide?: "above" | "below";
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom - 12;

  // ONE scale for both axes when a diagonal is drawn: the whole reading depends on
  // "is the dot above the line", which is only true if x and y are measured the same.
  const hiX = Math.max(...points.map((p) => p.x), 0);
  const hiY = Math.max(...points.map((p) => p.y), 0);
  const shared = niceScale(0, Math.max(hiX, hiY));
  const sx = breakEven ? shared : niceScale(0, hiX);
  const sy = breakEven ? shared : niceScale(0, hiY);

  const xFor = (v: number) => PAD.left + plotW * ((v - sx.min) / (sx.max - sx.min || 1));
  const yFor = (v: number) => PAD.top + plotH * (1 - (v - sy.min) / (sy.max - sy.min || 1));

  const maxWeight = points.reduce((m, p) => Math.max(m, p.weight ?? 0), 0);
  const radius = (p: ScatterPoint) =>
    maxWeight > 0 && p.weight != null
      ? // Area, not radius, tracks the weight — a dot twice the radius looks four
        // times the quantity.
        4 + Math.sqrt((p.weight ?? 0) / maxWeight) * 7
      : 5;

  const fx = FORMATTERS[xFormat];
  const fy = FORMATTERS[yFormat];

  const isGood = (p: ScatterPoint) =>
    refLine
      ? goodSide === "below"
        ? p.y <= refLine.value
        : p.y >= refLine.value
      : goodSide === "below"
        ? p.y <= p.x
        : p.y >= p.x;
  const shown = active != null ? points[active] : null;

  return (
    <div ref={ref} className="relative w-full">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>↑ {yLabel}</span>
        {refLine ? (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden="true">
              <line
                x1="0"
                y1="2"
                x2="16"
                y2="2"
                className="stroke-muted-foreground/60"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            </svg>
            {refLine.label} {fy(refLine.value)}
          </span>
        ) : null}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setActive(null)}
        >
          <Grid
            ticks={sy.ticks}
            yFor={yFor}
            width={width}
            format={yFormat === "percent" ? (v) => `${Math.round(v)}%` : shortNum}
          />

          {breakEven ? (
            <>
              <line
                x1={xFor(sx.min)}
                y1={yFor(sy.min)}
                x2={xFor(Math.min(sx.max, sy.max))}
                y2={yFor(Math.min(sx.max, sy.max))}
                className="stroke-muted-foreground/45"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={xFor(Math.min(sx.max, sy.max)) - 6}
                y={yFor(Math.min(sx.max, sy.max)) - 6}
                textAnchor="end"
                className="fill-muted-foreground text-[9px] tracking-wide uppercase"
              >
                Break even
              </text>
            </>
          ) : null}

          {refLine ? (
            <g>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={yFor(refLine.value)}
                y2={yFor(refLine.value)}
                className="stroke-muted-foreground/45"
                strokeWidth={1}
                strokeDasharray="4 4"
              />

            </g>
          ) : null}

          {points.map((p, i) => {
            const good = isGood(p);
            return (
              <g key={`${p.label}-${i}`} onPointerEnter={() => setActive(i)}>
                <circle
                  cx={xFor(p.x)}
                  cy={yFor(p.y)}
                  r={radius(p) + 6}
                  fill="transparent"
                />
                <circle
                  cx={xFor(p.x)}
                  cy={yFor(p.y)}
                  r={radius(p)}
                  fill={good ? "var(--color-chart-1)" : "var(--color-destructive)"}
                  fillOpacity={active == null || active === i ? 0.85 : 0.35}
                  className="stroke-card transition-all duration-200"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}

          {/* Axis names, bottom-right and top-left, so they never collide with a dot. */}
          <text
            x={width - PAD.right}
            y={height - 2}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {xLabel} →
          </text>
        </svg>
      )}

      {shown ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(Math.max(xFor(shown.x), 92), Math.max(width - 92, 92)),
            top: Math.max(4, yFor(shown.y) - 78),
          }}
          role="status"
        >
          <div className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {shown.label}
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{xLabel}</span>
            <span className="ml-auto font-medium tabular-nums">{fx(shown.x)}</span>
          </div>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{yLabel}</span>
            <span className="ml-auto font-medium tabular-nums">{fy(shown.y)}</span>
          </div>
          <div
            className={`mt-1 text-xs font-medium tabular-nums ${
              isGood(shown) ? "text-success-text" : "text-destructive-text"
            }`}
          >
            {breakEven
              ? `${fx(shown.x - shown.y)} ${isGood(shown) ? "ahead" : "behind"}`
              : refLine
                ? `${fy(Math.abs(shown.y - refLine.value))} ${shown.y >= refLine.value ? "above" : "below"} ${refLine.label.toLowerCase()}`
                : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
