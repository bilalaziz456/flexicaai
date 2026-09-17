"use client";

import { useCallback, useId } from "react";
import {
  ChartEmpty,
  ChartTooltip,
  Grid,
  PAD,
  TooltipRow,
  useChartWidth,
  usePointerIndex,
} from "@/core/ui/charts/chart-kit";
import {
  closeToBaseline,
  labelStride,
  money as fmtMoney,
  niceScale,
  shortNum,
  smoothPath,
  type Pt,
} from "@/core/ui/charts/geometry";

export type PlPoint = {
  label: string;
  /** Net profit for the bucket. Negative is a loss. */
  value: number;
  /** Optional context rows for the tooltip (revenue, costs — whatever made it). */
  parts?: { label: string; value: number }[];
};

/**
 * PROFIT & LOSS over time — a zero-centred curve whose fill changes colour where it
 * crosses the axis: green above, red below, with the zero line as the strongest rule
 * on the chart.
 *
 * This replaced grouped bars, which answered the wrong question. Bars invite you to
 * compare March with April; the question an owner actually asks is "when did we stop
 * making money, and are we climbing back". That is a shape, and a shape needs a line
 * — with the crossing point visible, which is the one moment a bar chart hides
 * completely, because a bar ending at zero and a bar ending just below it look the
 * same at a glance.
 *
 * HOW THE TWO-COLOUR FILL WORKS: one area path, drawn twice, each copy clipped to
 * its own half of the plot by a <clipPath> at the zero line. Not two separate paths
 * split at the crossings — computing those intersections means solving the cubic,
 * and being one pixel out would paint a sliver of loss red under a profitable month.
 * Clipping is exact by construction.
 */
export function ProfitLossChart({
  points,
  height = 260,
  valueLabel = "Net profit",
  formatValue = fmtMoney,
  emptyMessage = "No profit or loss recorded for this period yet.",
  ariaLabel,
}: {
  points: PlPoint[];
  height?: number;
  valueLabel?: string;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const uid = useId();
  const clipUp = `${uid}-up`;
  const clipDown = `${uid}-down`;
  const gradUp = `${uid}-gu`;
  const gradDown = `${uid}-gd`;

  const n = points.length;
  const padLeft = width < 420 ? 34 : PAD.left;
  const plotW = Math.max(0, width - padLeft - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  let hi = 0;
  let lo = 0;
  for (const p of points) {
    hi = Math.max(hi, p.value);
    lo = Math.min(lo, p.value);
  }
  // Both halves are scaled by the SAME rupee-per-pixel: a loss of 40k must look
  // exactly as deep as a profit of 40k is tall, or the chart flatters the business.
  // One shared step also keeps zero on a tick, which is where the baseline is drawn.
  const scale = niceScale(lo, Math.max(hi, 1));
  const top = scale.max;
  const bottom = scale.min;
  const span = top - bottom || 1;

  const xFor = useCallback(
    (i: number) => (n <= 1 ? padLeft + plotW / 2 : padLeft + (plotW * i) / (n - 1)),
    [n, padLeft, plotW],
  );
  const yFor = (v: number) => PAD.top + plotH * (1 - (v - bottom) / span);

  const { active, onMove, clear } = usePointerIndex(n, xFor);

  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const zeroY = yFor(0);
  const pts: Pt[] = points.map((p, i) => ({ x: xFor(i), y: yFor(p.value) }));
  const line = smoothPath(pts);
  const area = closeToBaseline(line, pts, zeroY);
  const stride = labelStride(n, plotW);
  const activePoint = active != null ? points[active] : null;
  const profitable = activePoint ? activePoint.value >= 0 : true;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onMove}
          onPointerLeave={clear}
          className="touch-pan-y select-none"
        >
          <defs>
            <clipPath id={clipUp}>
              <rect x={0} y={0} width={width} height={Math.max(0, zeroY)} />
            </clipPath>
            <clipPath id={clipDown}>
              <rect x={0} y={zeroY} width={width} height={Math.max(0, height - zeroY)} />
            </clipPath>
            <linearGradient id={gradUp} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={gradDown} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="var(--color-destructive)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--color-destructive)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <Grid ticks={scale.ticks} yFor={yFor} width={width} format={shortNum} zero={0} />

          <g className="chart-fade-in">
            <path d={area} fill={`url(#${gradUp})`} clipPath={`url(#${clipUp})`} />
            <path d={area} fill={`url(#${gradDown})`} clipPath={`url(#${clipDown})`} />
          </g>

          {/* The line takes the same treatment, so the stroke itself turns red the
              moment the business does. */}
          <g>
            <path
              d={line}
              pathLength={1}
              fill="none"
              stroke="var(--color-success)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${clipUp})`}
              className="chart-draw"
            />
            <path
              d={line}
              pathLength={1}
              fill="none"
              stroke="var(--color-destructive)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${clipDown})`}
              className="chart-draw"
            />
          </g>

          {active != null ? (
            <g>
              <line
                x1={xFor(active)}
                x2={xFor(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-border"
                strokeWidth={1}
              />
              <circle
                cx={xFor(active)}
                cy={yFor(points[active].value)}
                r={3.5}
                fill={
                  points[active].value >= 0
                    ? "var(--color-success)"
                    : "var(--color-destructive)"
                }
                className="stroke-card"
                strokeWidth={1.5}
              />
            </g>
          ) : null}

          {points.map((p, i) =>
            i % stride === 0 ? (
              <text
                key={`${p.label}-${i}`}
                x={xFor(i)}
                y={PAD.top + plotH + 16}
                textAnchor={i === 0 ? "start" : i >= n - stride ? "end" : "middle"}
                className="fill-muted-foreground text-[10px]"
              >
                {p.label}
              </text>
            ) : null,
          )}
        </svg>
      )}

      {activePoint ? (
        <ChartTooltip x={xFor(active!)} width={width} title={activePoint.label}>
          <TooltipRow
            label={activePoint.value >= 0 ? valueLabel : "Net loss"}
            value={formatValue(activePoint.value)}
            color={profitable ? "var(--color-success)" : "var(--color-destructive)"}
          />
          {activePoint.parts?.map((part) => (
            <TooltipRow key={part.label} label={part.label} value={formatValue(part.value)} muted />
          ))}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
