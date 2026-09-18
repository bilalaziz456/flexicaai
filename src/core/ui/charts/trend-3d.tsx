"use client";

import { useState } from "react";
import { ChartEmpty, PAD, useChartWidth } from "@/core/ui/charts/chart-kit";
import {
  money as fmtMoney,
  niceScale,
  shortNum,
  smoothPath,
  type Pt,
} from "@/core/ui/charts/geometry";
import type { TrendPoint } from "@/core/ui/charts/trend-chart";

/**
 * A THREE-DIMENSIONAL trend, built for side-by-side comparison against the flat one.
 *
 * ⚠ NOT THE DEFAULT, and the reasons are worse here than they are for the donut.
 * A tilted ring at least keeps its data in one plane; extruding a time series adds a
 * depth axis that carries NO DATA AT ALL, and then charges the reader for it:
 *
 *  - **The front series hides the back one.** Two measures at two depths means the
 *    nearer ribbon occludes the further one wherever they cross or run close. On
 *    "earned vs paid" the paid line spends most of the period near zero — exactly
 *    where the earned ribbon's front wall is — so the series that matters is the one
 *    you cannot see.
 *  - **A value can no longer be read against the axis.** In the flat chart a point's
 *    height IS its value; here every point is displaced right and up by its depth, so
 *    following it back to a gridline is a guess. The axis becomes decoration.
 *  - **A SPIKE IS DRAWN TWICE.** The slab has a front edge and a back edge, so a
 *    single tall day appears as two adjacent peaks — the 40k payment in the demo data
 *    reads as two payments. This is the clearest failure of the lot and it is visible
 *    at a glance in the comparison.
 *  - **The gap between two series stops being measurable.** "Cumulative earned vs
 *    paid" exists to show that gap — it is the outstanding balance, and the card says
 *    so. On two planes the distance is part value and part perspective. Measured
 *    against the real data the damage here is milder than expected, because the gap
 *    is enormous and survives being sheared; it would not survive two series running
 *    close together, and the top surface no longer lines up with its own axis either
 *    way.
 *
 * Drawn honestly within those limits — the same curve, the same scale, the same
 * colours, and the tooltip still reports the true figures.
 */

/** How far back each plane sits, in px. Right and up = "away" from the viewer. */
const DEPTH_X = 26;
const DEPTH_Y = 16;

export function Trend3D({
  points,
  valueLabel = "Total",
  overlayLabel,
  color = "var(--color-chart-1)",
  overlayColor = "var(--color-chart-4)",
  height = 260,
  emptyMessage = "No data for this period yet.",
  ariaLabel,
}: {
  points: TrendPoint[];
  valueLabel?: string;
  /** When set, `point.second` is drawn as a second ribbon, nearer the viewer. */
  overlayLabel?: string;
  color?: string;
  overlayColor?: string;
  height?: number;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = points.length;
  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const plotW = Math.max(0, width - PAD.left - PAD.right - DEPTH_X);
  const plotH = height - PAD.top - PAD.bottom - DEPTH_Y;
  const baseY = PAD.top + DEPTH_Y + plotH;

  let max = 0;
  for (const p of points) max = Math.max(max, p.value, p.second ?? 0);
  const scale = niceScale(0, max);

  const xFor = (i: number) => (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yFor = (v: number) => plotH * (1 - (v - scale.min) / (scale.max - scale.min || 1));

  /** Project a data point onto the plane `z` (1 = furthest back). */
  const project = (i: number, v: number, z: number): Pt => ({
    x: PAD.left + xFor(i) + DEPTH_X * z,
    y: PAD.top + DEPTH_Y + yFor(v) - DEPTH_Y * z,
  });

  const ribbon = (values: number[], z: number) => {
    const front = values.map((v, i) => project(i, v, z));
    const back = values.map((v, i) => project(i, v, z + 0.55));
    const frontLine = smoothPath(front);
    // The slab's top: the curve, across to the same curve one step deeper, back again.
    const top = `${frontLine} L${back[n - 1].x},${back[n - 1].y} ${smoothPath([...back].reverse())
      .replace(/^M[^ ]+ /, "")} Z`;
    // The wall: the front curve dropped to the floor of its own plane.
    const floor = baseY - DEPTH_Y * z;
    const wall = `${frontLine} L${front[n - 1].x},${floor} L${front[0].x},${floor} Z`;
    return { top, wall, front, frontLine };
  };

  const hasOverlay = Boolean(overlayLabel) && points.some((p) => typeof p.second === "number");
  // Back to front: the FURTHER series is painted first so the nearer one covers it —
  // which is the occlusion this chart exists to demonstrate.
  const first = ribbon(points.map((p) => p.value), 1);
  const second = hasOverlay ? ribbon(points.map((p) => p.second ?? 0), 0) : null;

  const activePoint = active != null ? points[active] : null;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="select-none"
          onPointerLeave={() => setActive(null)}
        >
          {/* The floor grid, sheared to the same perspective, so the slabs have
              something to stand on. */}
          {scale.ticks.map((t) => {
            const a = project(0, t, 0);
            const b = project(n - 1, t, 0);
            const c = project(n - 1, t, 1);
            return (
              <g key={t}>
                <path
                  d={`M${a.x},${a.y} L${b.x},${b.y} L${c.x},${c.y}`}
                  fill="none"
                  className="stroke-border/50"
                  strokeWidth={1}
                  strokeDasharray="2 5"
                />
                <text
                  x={PAD.left - 8}
                  y={a.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {shortNum(t)}
                </text>
              </g>
            );
          })}

          <g>
            <path d={first.wall} fill={color} fillOpacity={0.22} />
            <path d={first.top} fill={color} fillOpacity={0.55} />
            <path
              d={first.frontLine}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </g>

          {second ? (
            <g>
              <path d={second.wall} fill={overlayColor} fillOpacity={0.28} />
              <path d={second.top} fill={overlayColor} fillOpacity={0.65} />
              <path
                d={second.frontLine}
                fill="none"
                stroke={overlayColor}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </g>
          ) : null}

          {points.map((p, i) => (
            <rect
              key={`${p.label}-${i}`}
              x={PAD.left + xFor(i) - Math.max(6, plotW / n / 2)}
              y={PAD.top}
              width={Math.max(12, plotW / n)}
              height={height - PAD.top}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
            />
          ))}

          {activePoint ? (
            <circle
              cx={project(active!, activePoint.value, 1).x}
              cy={project(active!, activePoint.value, 1).y}
              r={3.5}
              fill={color}
              className="stroke-card"
              strokeWidth={1.5}
            />
          ) : null}
        </svg>
      )}

      {activePoint ? (
        <div
          className="pointer-events-none absolute top-1 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm"
          role="status"
        >
          <div className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {activePoint.label}
          </div>
          <div className="mt-0.5 text-sm tabular-nums">
            {valueLabel} {fmtMoney(activePoint.value)}
          </div>
          {hasOverlay ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              {overlayLabel} {fmtMoney(activePoint.second ?? 0)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
