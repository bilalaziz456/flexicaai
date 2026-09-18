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

export type LedgerPoint = {
  label: string;
  /** The continuous measure — accrues a little most periods. */
  flow: number;
  /** The discrete measure — happens on a few periods and is zero on the rest. */
  event: number;
};

/**
 * ACCRUAL AND EVENTS — one continuous measure and one that only happens sometimes,
 * drawn as the different kinds of thing they are.
 *
 * WHAT THIS REPLACED, and why it was wrong. "Earned vs paid" was two area/line series
 * on one axis, which says the two behave alike. They do not: earnings accrue a little
 * on most days as visits complete, while a PAYOUT is an event — nothing, nothing,
 * nothing, then forty thousand rupees on the ninth. Drawing that as a line implies the
 * clinic was paying something out on all the days in between, and the single spike had
 * to carry the entire y-axis, flattening the accrual it was supposed to be compared
 * with.
 *
 * So the flow is an area and the events are STEMS: one mark per payment, at its own
 * height, labelled. You read "earnings built up steadily, and we paid twice" in one
 * pass, which is the actual sentence the data says.
 *
 * The events keep their own scale. A payout is typically an order of magnitude bigger
 * than a day's accrual, and forcing both onto one axis makes the smaller series a flat
 * line along the bottom — so the stems are scaled to the largest event and their
 * figures are printed, which is what makes the two readable together at all. The
 * tooltip always reports both in rupees, so the difference in scale can never be
 * mistaken for a difference in size.
 */
export function LedgerTimeline({
  points,
  flowLabel = "Earned",
  eventLabel = "Paid",
  flowColor = "var(--color-chart-1)",
  eventColor = "var(--color-chart-4)",
  height = 260,
  emptyMessage = "Nothing recorded in this period yet.",
  ariaLabel,
}: {
  points: LedgerPoint[];
  flowLabel?: string;
  eventLabel?: string;
  flowColor?: string;
  eventColor?: string;
  height?: number;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const uid = useId();
  const grad = `${uid}-flow`;

  const n = points.length;
  const padLeft = width < 420 ? 34 : PAD.left;
  const plotW = Math.max(0, width - padLeft - PAD.right);
  // The stems hang from the top, so the flow gets the lower two-thirds and they never
  // fight for the same pixels.
  const stemBand = 58;
  const plotH = height - PAD.top - PAD.bottom - stemBand;
  const baseY = PAD.top + stemBand + plotH;

  const flowMax = points.reduce((m, p) => Math.max(m, p.flow), 0);
  const eventMax = points.reduce((m, p) => Math.max(m, p.event), 0);
  const scale = niceScale(0, flowMax);

  const xFor = useCallback(
    (i: number) => (n <= 1 ? padLeft + plotW / 2 : padLeft + (plotW * i) / (n - 1)),
    [n, padLeft, plotW],
  );
  const yFor = (v: number) =>
    PAD.top + stemBand + plotH * (1 - (v - scale.min) / (scale.max - scale.min || 1));

  const { active, onMove, clear } = usePointerIndex(n, xFor);

  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const pts: Pt[] = points.map((p, i) => ({ x: xFor(i), y: yFor(p.flow) }));
  const line = smoothPath(pts);
  const area = closeToBaseline(line, pts, baseY);
  const stride = labelStride(n, plotW);
  const activePoint = active != null ? points[active] : null;
  const events = points
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.event > 0);

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
            <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={flowColor} stopOpacity={0.32} />
              <stop offset="100%" stopColor={flowColor} stopOpacity={0} />
            </linearGradient>
          </defs>

          <Grid ticks={scale.ticks} yFor={yFor} width={width} format={shortNum} />

          <path d={area} fill={`url(#${grad})`} className="chart-fade-in" />
          <path
            d={line}
            pathLength={1}
            fill="none"
            stroke={flowColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="chart-draw"
          />

          {/* The events, hanging from a rail of their own. A stem cannot be mistaken
              for a continuous series the way a second line can. */}
          <line
            x1={padLeft}
            x2={width - PAD.right}
            y1={PAD.top + 6}
            y2={PAD.top + 6}
            className="stroke-border/60"
            strokeWidth={1}
          />
          {events.map((e) => {
            const x = xFor(e.i);
            const h = eventMax > 0 ? (e.event / eventMax) * (stemBand - 20) : 0;
            const y = PAD.top + 6 + h;
            return (
              <g key={`e-${e.i}`} opacity={active == null || active === e.i ? 1 : 0.4}>
                <line
                  x1={x}
                  y1={PAD.top + 6}
                  x2={x}
                  y2={y}
                  stroke={eventColor}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={active === e.i ? 5 : 3.5}
                  fill={eventColor}
                  className="stroke-card transition-all"
                  strokeWidth={1.5}
                />
                <text
                  x={x}
                  y={PAD.top + 1}
                  /* A payout on the first or last day of the range would hang half its
                     figure outside the svg, so the end stems anchor inward. */
                  textAnchor={
                    x - padLeft < 18 ? "start" : width - PAD.right - x < 18 ? "end" : "middle"
                  }
                  className="fill-muted-foreground text-[10px] font-medium tabular-nums"
                >
                  {shortNum(e.event)}
                </text>
              </g>
            );
          })}

          {active != null ? (
            <g>
              <line
                x1={xFor(active)}
                x2={xFor(active)}
                y1={PAD.top + 6}
                y2={baseY}
                className="stroke-border"
                strokeWidth={1}
              />
              <circle
                cx={xFor(active)}
                cy={yFor(points[active].flow)}
                r={3.5}
                fill={flowColor}
                className="stroke-card"
                strokeWidth={1.5}
              />
            </g>
          ) : null}

          {points.map((p, i) =>
            i % stride === 0 ? (
              <text
                key={`l-${p.label}-${i}`}
                x={xFor(i)}
                y={baseY + 16}
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
          <TooltipRow label={flowLabel} value={fmtMoney(activePoint.flow)} color={flowColor} />
          <TooltipRow
            label={eventLabel}
            value={activePoint.event > 0 ? fmtMoney(activePoint.event) : "—"}
            color={activePoint.event > 0 ? eventColor : undefined}
            muted={activePoint.event === 0}
          />
        </ChartTooltip>
      ) : null}
    </div>
  );
}
