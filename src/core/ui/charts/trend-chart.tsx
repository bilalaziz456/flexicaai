"use client";

import { useCallback } from "react";
import {
  ChartEmpty,
  ChartTooltip,
  Grid,
  PAD,
  TooltipRow,
  useChartWidth,
  useGradient,
  usePointerIndex,
} from "@/core/ui/charts/chart-kit";
import {
  closeToBaseline,
  labelStride,
  money as fmtMoney,
  niceScale,
  percentChange,
  shortNum,
  smoothPath,
  type Pt,
} from "@/core/ui/charts/geometry";

export type TrendPoint = {
  label: string;
  value: number;
  /** Same bucket in the comparison window, when the caller has one. */
  previous?: number;
  /** A SECOND measure in the same units — see `overlay`. */
  second?: number;
};

/**
 * A second series of the same kind, drawn over the first: earned vs paid, billed vs
 * collected. Distinct from `previous`, which is the SAME measure in an earlier
 * window and is drawn faintly; this one is a different measure and is a full citizen.
 */
export type TrendOverlay = {
  label: string;
  color?: string;
  /**
   * Tint the region between the two lines. Use it when the GAP is itself the thing
   * being shown — cumulative earned against cumulative paid, where the space between
   * them is what the clinic still owes.
   */
  fillGap?: boolean;
  gapLabel?: string;
};

/**
 * TREND over time — the app's default chart for anything that moves with the calendar:
 * revenue collected, expenses, growth, usage. A smooth gradient area (or a bare line)
 * with a crosshair, a floating tooltip and an optional comparison series.
 *
 * Why an area and not bars: these series are FLOWS a clinic reads as a shape — "did it
 * pick up after Eid" — not a set of independent quantities to compare one against
 * another. Bars invite the second reading and cost most of the horizontal space to
 * gutters, which is why ninety daily buckets used to arrive as a grey comb.
 *
 * The comparison series is drawn as a thin dashed line UNDER the current one, never a
 * second filled area: two fills of the same metric fight for the same space and the
 * eye cannot tell which is now.
 */
export function TrendChart({
  points,
  overlay,
  color = "var(--color-chart-1)",
  height = 240,
  mode = "area",
  comparisonLabel = "Previous period",
  valueLabel = "Total",
  formatValue = fmtMoney,
  emptyMessage = "No data for this period yet.",
  ariaLabel,
}: {
  points: TrendPoint[];
  overlay?: TrendOverlay;
  color?: string;
  height?: number;
  mode?: "area" | "line";
  comparisonLabel?: string;
  valueLabel?: string;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [gradId, gradDef] = useGradient();

  const n = points.length;
  const hasComparison = points.some((p) => typeof p.previous === "number");

  // A narrow screen gets a narrower value axis: 48px of labels out of a 320px card is
  // a fifth of the drawing spent on numbers the curve already tells you.
  const padLeft = width < 420 ? 34 : PAD.left;
  const plotW = Math.max(0, width - padLeft - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  let max = 0;
  let min = 0;
  for (const p of points) {
    max = Math.max(max, p.value, p.previous ?? 0, p.second ?? 0);
    min = Math.min(min, p.value, p.previous ?? 0, p.second ?? 0);
  }
  // Amber, not chart-2. The default pairing was teal against brand blue — adjacent
  // hues that read as one colour in a legend of two small dots, which is the whole
  // job a legend has. This separates in both themes and for the common colour-vision
  // deficiencies, where teal-vs-blue does not.
  const overlayColor = overlay?.color ?? "var(--color-chart-4)";
  const scale = niceScale(min, max);

  const xFor = useCallback(
    (i: number) => (n <= 1 ? padLeft + plotW / 2 : padLeft + (plotW * i) / (n - 1)),
    [n, padLeft, plotW],
  );
  const yFor = (v: number) =>
    PAD.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min || 1));

  const { active, onMove, clear } = usePointerIndex(n, xFor);

  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const pts: Pt[] = points.map((p, i) => ({ x: xFor(i), y: yFor(p.value) }));
  const line = smoothPath(pts);
  const area = mode === "area" ? closeToBaseline(line, pts, yFor(scale.min)) : "";
  const prevLine = hasComparison
    ? smoothPath(points.map((p, i) => ({ x: xFor(i), y: yFor(p.previous ?? 0) })))
    : "";

  // The overlay, and the band between the two series. The band is built by running
  // the first curve forward and the second BACK along the same xs, so the two edges
  // are the identical curves — the gap can never be drawn wider or narrower than the
  // numbers it stands for.
  const secondPts: Pt[] = overlay
    ? points.map((p, i) => ({ x: xFor(i), y: yFor(p.second ?? 0) }))
    : [];
  const secondLine = overlay ? smoothPath(secondPts) : "";
  const gapPath =
    overlay?.fillGap && secondPts.length > 1
      ? `${line} L${secondPts[secondPts.length - 1].x},${secondPts[secondPts.length - 1].y} ${smoothPath(
          [...secondPts].reverse(),
        ).replace(/^M[^ ]+ /, "")} Z`
      : "";

  const stride = labelStride(n, plotW);
  const activePoint = active != null ? points[active] : null;
  const delta =
    activePoint && typeof activePoint.previous === "number"
      ? percentChange(activePoint.value, activePoint.previous)
      : null;

  return (
    <div ref={ref} className="relative w-full">
      {overlay ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {[
            { label: valueLabel, c: color },
            { label: overlay.label, c: overlayColor },
          ].map((it) => (
            <li key={it.label} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: it.c }}
                aria-hidden="true"
              />
              {it.label}
            </li>
          ))}
        </ul>
      ) : null}
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
          <defs>{gradDef(color)}</defs>

          <Grid ticks={scale.ticks} yFor={yFor} width={width} format={shortNum} />

          {/* Comparison first, so today's line always sits on top of yesterday's. */}
          {prevLine ? (
            <path
              d={prevLine}
              fill="none"
              stroke="currentColor"
              className="text-muted-foreground/45"
              strokeWidth={1.25}
              strokeDasharray="3 4"
              strokeLinecap="round"
            />
          ) : null}

          {area ? <path d={area} fill={`url(#${gradId})`} className="chart-fade-in" /> : null}
          {gapPath ? (
            <path d={gapPath} fill={color} fillOpacity={0.14} className="chart-fade-in" />
          ) : null}
          {/* `pathLength={1}` normalises the dash used by `.chart-draw`, so a
              90-day curve and a 6-point one take the same time to draw. */}
          <path
            d={line}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="chart-draw"
          />

          {secondLine ? (
            <path
              d={secondLine}
              pathLength={1}
              fill="none"
              stroke={overlayColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="chart-draw"
            />
          ) : null}

          {/* Crosshair + the point under the pointer. No dot on every bucket: ninety
              dots is a dotted line, and the one that matters is the one you are on. */}
          {active != null ? (
            <g>
              <line
                x1={xFor(active)}
                x2={xFor(active)}
                y1={PAD.top}
                y2={baseY}
                className="stroke-border"
                strokeWidth={1}
              />
              <circle
                cx={xFor(active)}
                cy={yFor(points[active].value)}
                r={5.5}
                fill={color}
                fillOpacity={0.18}
              />
              <circle
                cx={xFor(active)}
                cy={yFor(points[active].value)}
                r={3}
                fill={color}
                className="stroke-card"
                strokeWidth={1.5}
              />
              {overlay ? (
                <circle
                  cx={xFor(active)}
                  cy={yFor(points[active].second ?? 0)}
                  r={3}
                  fill={overlayColor}
                  className="stroke-card"
                  strokeWidth={1.5}
                />
              ) : null}
            </g>
          ) : null}

          {points.map((p, i) =>
            i % stride === 0 ? (
              <text
                key={`${p.label}-${i}`}
                x={xFor(i)}
                y={baseY + 16}
                /* The end labels anchor INWARDS. Centred, the first and last sit half
                   outside the plot and the last one is clipped by the card. */
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
          <TooltipRow label={valueLabel} value={formatValue(activePoint.value)} color={color} />
          {overlay ? (
            <TooltipRow
              label={overlay.label}
              value={formatValue(activePoint.second ?? 0)}
              color={overlayColor}
            />
          ) : null}
          {overlay?.fillGap ? (
            <TooltipRow
              label={overlay.gapLabel ?? "Difference"}
              value={formatValue(activePoint.value - (activePoint.second ?? 0))}
              muted
            />
          ) : null}
          {typeof activePoint.previous === "number" ? (
            <TooltipRow
              label={comparisonLabel}
              value={formatValue(activePoint.previous)}
              muted
            />
          ) : null}
          {delta != null ? (
            <div
              className={`mt-1 text-xs font-medium tabular-nums ${
                delta >= 0 ? "text-success-text" : "text-destructive-text"
              }`}
            >
              {delta >= 0 ? "+" : "−"}
              {Math.abs(delta).toFixed(1)}% vs {comparisonLabel.toLowerCase()}
            </div>
          ) : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
