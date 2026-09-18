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

export type BalancePoint = {
  label: string;
  /** What is owed at the end of this period. */
  balance: number;
  /** Optional context, reported on hover: the two figures the balance came from. */
  earned?: number;
  paid?: number;
};

/**
 * A RUNNING BALANCE — the thing that is owed, plotted directly.
 *
 * WHAT THIS REPLACED. "Cumulative earned vs paid" drew two rising lines and tinted the
 * space between them, with a caption explaining that the gap was the outstanding
 * balance. The gap WAS the balance — but a gap is something the reader has to measure,
 * between two lines that are both climbing, neither of which is the number anyone came
 * for. On the real data both lines run most of the way up the axis and the quantity
 * that matters is the distance between them, which is the hardest thing on a chart to
 * judge.
 *
 * So the subtraction is done here instead: one series, at its own scale, filling the
 * axis it deserves. A payout now reads as what it is — a STEP DOWN in what is owed —
 * and the marks that fall are annotated, so "we paid, and this is what it moved" is a
 * reading rather than an inference.
 *
 * The current balance is called out at the right-hand end, because on a balance chart
 * the last point is the answer and it should not have to be hunted for.
 */
export function BalanceTrend({
  points,
  valueLabel = "Outstanding",
  color = "var(--color-chart-1)",
  dropColor = "var(--color-chart-4)",
  height = 260,
  emptyMessage = "Nothing outstanding in this period.",
  ariaLabel,
}: {
  points: BalancePoint[];
  valueLabel?: string;
  color?: string;
  dropColor?: string;
  height?: number;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const uid = useId();
  const grad = `${uid}-bal`;

  const n = points.length;
  const padLeft = width < 420 ? 34 : PAD.left;
  // Room on the right for the closing figure, which is the point of the chart.
  const padRight = width < 420 ? PAD.right : 74;
  const plotW = Math.max(0, width - padLeft - padRight);
  const plotH = height - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  let hi = points[0]?.balance ?? 0;
  let lo = points[0]?.balance ?? 0;
  for (const p of points) {
    hi = Math.max(hi, p.balance);
    lo = Math.min(lo, p.balance);
  }
  const travel = hi - lo;
  /**
   * WHY the axis does not always start at zero. An outstanding balance is a LEVEL that
   * moves by a fraction of itself: 830k drifting down to 515k is three hundred thousand
   * rupees paid, and measured from zero it is a shallow dent along the top of a solid
   * block of colour — the chart draws the balance and hides the news.
   *
   * The test is whether the series ever comes NEAR zero, not how far it travels. A
   * balance that runs down to nothing has been settled, and "settled" is a fact about
   * zero, so the axis must show zero. A balance that never drops below two-thirds of its
   * peak is a level being maintained, and the reader's question is which way it moved.
   *
   * When it zooms, the fill goes with it: an area reads as "this much, measured from
   * zero", which stops being true the moment the baseline is 480k. The zoomed view is a
   * line against a dotted OPENING balance — the change, which is the only thing a zoomed
   * axis can honestly claim to show.
   */
  const fromZero = hi <= 0 || travel === 0 || lo <= hi * 0.25;
  const scale = fromZero
    ? niceScale(Math.min(0, lo), hi)
    : // Tight headroom and a finer step: rounding a zoomed window to 4 ticks snaps the
      // bounds so far out (388k…911k became 200k…1M) that most of the plot is empty
      // again, which is the thing zooming was for.
      niceScale(lo - travel * 0.25, hi + travel * 0.1, 5, false);

  const xFor = useCallback(
    (i: number) => (n <= 1 ? padLeft + plotW / 2 : padLeft + (plotW * i) / (n - 1)),
    [n, padLeft, plotW],
  );
  const yFor = (v: number) =>
    PAD.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min || 1));

  const { active, onMove, clear } = usePointerIndex(n, xFor);

  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const pts: Pt[] = points.map((p, i) => ({ x: xFor(i), y: yFor(p.balance) }));
  const line = smoothPath(pts);
  const area = closeToBaseline(line, pts, yFor(scale.min));
  const stride = labelStride(n, plotW);
  const activePoint = active != null ? points[active] : null;
  const last = points[n - 1];

  // Where the balance actually fell — a payment landing, in other words.
  // Which way the line leaves its opening level — used to place the opening label.
  const lookahead = points.slice(1, 7);
  const opensUpward =
    lookahead.length > 0 &&
    lookahead.reduce((s, p) => s + p.balance, 0) / lookahead.length >= points[0].balance;

  const drops = points
    .map((p, i) => ({ ...p, i, delta: i > 0 ? p.balance - points[i - 1].balance : 0 }))
    .filter((p) => p.delta < 0);
  const biggestDrop = drops.reduce((m, d) => Math.min(m, d.delta), 0);

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
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <Grid ticks={scale.ticks} yFor={yFor} width={width - (padRight - PAD.right)} format={shortNum} />

          {fromZero ? (
            <path d={area} fill={`url(#${grad})`} className="chart-fade-in" />
          ) : (
            /* The level the period opened at — the anchor a zoomed axis takes away. */
            <g>
              <line
                x1={padLeft}
                x2={xFor(n - 1)}
                y1={yFor(points[0].balance)}
                y2={yFor(points[0].balance)}
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <text
                /* Against PAD.left, not the narrow phone padding: the axis figures are
                   drawn at PAD.left - 8 whatever the width, so anything starting left
                   of it collides with them on a phone. */
                x={PAD.left + 4}
                /* On the side the line is NOT heading: at 390px the curve runs within a
                   few pixels of its own opening level, so a fixed offset gets struck
                   through by the series it is annotating. */
                y={yFor(points[0].balance) + (opensUpward ? 14 : -7)}
                className="fill-muted-foreground text-[10px]"
              >
                Opening {shortNum(points[0].balance)}
              </text>
            </g>
          )}
          <path
            d={line}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="chart-draw"
          />

          {/* Every fall is a payment. Marked, because that is the only place on this
              chart where something actually happened. */}
          {drops.map((d) => (
            <g key={`d-${d.i}`} opacity={active == null || active === d.i ? 1 : 0.45}>
              <circle
                cx={xFor(d.i)}
                cy={yFor(d.balance)}
                r={d.delta <= biggestDrop * 0.5 ? 4.5 : 3}
                fill={dropColor}
                className="stroke-card"
                strokeWidth={1.5}
              />
            </g>
          ))}

          {/* The closing balance, at the end of the line where the answer is. */}
          <g>
            <circle
              cx={xFor(n - 1)}
              cy={yFor(last.balance)}
              r={4}
              fill={color}
              className="stroke-card"
              strokeWidth={2}
            />
            {width >= 420 ? (
              <text
                x={xFor(n - 1) + 10}
                y={yFor(last.balance)}
                dominantBaseline="middle"
                className="fill-foreground text-[11px] font-semibold tabular-nums"
              >
                {shortNum(last.balance)}
              </text>
            ) : null}
          </g>

          {active != null ? (
            <line
              x1={xFor(active)}
              x2={xFor(active)}
              y1={PAD.top}
              y2={baseY}
              className="stroke-border"
              strokeWidth={1}
            />
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
          <TooltipRow label={valueLabel} value={fmtMoney(activePoint.balance)} color={color} />
          {typeof activePoint.earned === "number" ? (
            <TooltipRow label="Earned to date" value={fmtMoney(activePoint.earned)} muted />
          ) : null}
          {typeof activePoint.paid === "number" ? (
            <TooltipRow label="Paid to date" value={fmtMoney(activePoint.paid)} muted />
          ) : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
