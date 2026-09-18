"use client";

import { useId, useState } from "react";
import { ChartEmpty, PAD, useChartWidth } from "@/core/ui/charts/chart-kit";
import {
  money as fmtMoney,
  labelStride,
  niceScale,
  shortNum,
  smoothPath,
  type Pt,
} from "@/core/ui/charts/geometry";
import type { TrendPoint } from "@/core/ui/charts/trend-chart";

/**
 * A dimensional trend — each series is a GLASS CURTAIN standing on a perspective
 * floor, drawn beside the flat chart so the two can be compared.
 *
 * THIS IS THE SECOND DESIGN, and the first one is why. That version extruded each
 * series into a solid slab, and the slab was the whole problem: it has a front edge
 * AND a back edge, so one tall day was drawn as two peaks — a single 40k payment read
 * as two payments — while the opaque walls buried whichever series stood behind.
 *
 * A curtain has exactly one edge, which is the curve itself, so a spike is a spike.
 * The sheet hanging from it is glass, so the series at the back reads THROUGH the one
 * in front instead of being lost to it. The room around them — gridlines on the back
 * wall, rails running forward, ribs across the floor — is what makes the depth read as
 * deliberate rather than as a rendering accident, and it gives the eye a way to carry
 * a value from the axis to a curtain standing further back.
 *
 * What the depth still costs, said plainly:
 *  - A point is displaced right and up by its plane, so reading a value off the axis
 *    takes more care than in the flat chart, where height simply IS the value.
 *  - Two series stand on different planes, so they are no longer directly comparable
 *    at a glance — which is exactly what the flat chart beside it is for.
 *
 * Everything else is true: real curve geometry, one scale shared by both series, the
 * same colours as the flat version, and a tooltip carrying the actual figures.
 */

/** The offset between depth planes. Right and up reads as "further away". */
const DEPTH_X = 34;
const DEPTH_Y = 22;

export function Trend3D({
  points,
  valueLabel = "Total",
  overlayLabel,
  color = "var(--color-chart-1)",
  overlayColor = "var(--color-chart-4)",
  height = 280,
  emptyMessage = "No data for this period yet.",
  ariaLabel,
}: {
  points: TrendPoint[];
  valueLabel?: string;
  /** When set, `point.second` is drawn as a second curtain, standing in front. */
  overlayLabel?: string;
  color?: string;
  overlayColor?: string;
  height?: number;
  emptyMessage?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const uid = useId();

  const n = points.length;
  if (n === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const plotW = Math.max(0, width - PAD.left - PAD.right - DEPTH_X);
  const plotH = height - PAD.top - PAD.bottom - DEPTH_Y;
  const topY = PAD.top + DEPTH_Y;

  let max = 0;
  for (const p of points) max = Math.max(max, p.value, p.second ?? 0);
  const scale = niceScale(0, max);
  const span = scale.max - scale.min || 1;

  const xFor = (i: number) => (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yFor = (v: number) => plotH * (1 - (v - scale.min) / span);

  /** Project onto plane `z` — 0 is nearest the viewer, 1 is the back wall. */
  const project = (i: number, v: number, z: number): Pt => ({
    x: PAD.left + xFor(i) + DEPTH_X * z,
    y: topY + yFor(v) - DEPTH_Y * z,
  });

  /** One curtain: the curve, and a glass sheet hanging from it to the floor. */
  const curtain = (values: number[], z: number) => {
    const pts: Pt[] = values.map((v, i) => project(i, v, z));
    const line = smoothPath(pts);
    const floorL = project(0, scale.min, z);
    const floorR = project(n - 1, scale.min, z);
    const sheet = `${line} L${floorR.x},${floorR.y} L${floorL.x},${floorL.y} Z`;
    return { pts, line, sheet };
  };

  const hasOverlay = Boolean(overlayLabel) && points.some((p) => typeof p.second === "number");
  // The main series stands at the BACK and the overlay in front, so the front sheet's
  // glass is something you look through rather than something you look at.
  const back = curtain(
    points.map((p) => p.value),
    1,
  );
  const front = hasOverlay
    ? curtain(
        points.map((p) => p.second ?? 0),
        0,
      )
    : null;

  const stride = labelStride(n, plotW);
  const activePoint = active != null ? points[active] : null;
  const gFloor = `${uid}-gfl`;
  const gBack = `${uid}-gb`;
  const gFront = `${uid}-gf`;

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
          <defs>
            {/* The sheets fade downward, so a curtain reads as hanging from its curve
                rather than as a solid block standing on the floor. */}
            {/* The floor recedes as it goes back, which is most of what sells the
                depth — without a ground plane the curtains hang in nothing. */}
            <linearGradient id={gFloor} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="var(--color-muted-foreground)" stopOpacity={0.10} />
              <stop offset="100%" stopColor="var(--color-muted-foreground)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={gBack} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id={gFront} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={overlayColor} stopOpacity={0.45} />
              <stop offset="100%" stopColor={overlayColor} stopOpacity={0.05} />
            </linearGradient>
          </defs>

          {/* THE ROOM: gridlines on the back wall, rails running forward, ribs across
              the floor. Without it the curtains float in space and the depth reads as
              an accident; with it the eye can carry a value forward from the axis. */}
          <g aria-hidden="true">
            <path
              d={[
                `M${project(0, scale.min, 0).x},${project(0, scale.min, 0).y}`,
                `L${project(n - 1, scale.min, 0).x},${project(n - 1, scale.min, 0).y}`,
                `L${project(n - 1, scale.min, 1).x},${project(n - 1, scale.min, 1).y}`,
                `L${project(0, scale.min, 1).x},${project(0, scale.min, 1).y}`,
                "Z",
              ].join(" ")}
              fill={`url(#${gFloor})`}
            />
            {scale.ticks.map((t) => {
              const a = project(0, t, 1);
              const b = project(n - 1, t, 1);
              const f = project(0, t, 0);
              return (
                <g key={t}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="stroke-border/50"
                    strokeWidth={1}
                    strokeDasharray="2 5"
                  />
                  <line
                    x1={f.x}
                    y1={f.y}
                    x2={a.x}
                    y2={a.y}
                    className="stroke-border/35"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={f.y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {shortNum(t)}
                  </text>
                </g>
              );
            })}
            {points.map((p, i) =>
              i % stride === 0 ? (
                <line
                  key={`rib-${p.label}-${i}`}
                  x1={project(i, scale.min, 0).x}
                  y1={project(i, scale.min, 0).y}
                  x2={project(i, scale.min, 1).x}
                  y2={project(i, scale.min, 1).y}
                  className="stroke-border/30"
                  strokeWidth={1}
                />
              ) : null,
            )}
          </g>

          <g>
            <path d={back.sheet} fill={`url(#${gBack})`} className="chart-fade-in" />
            <path
              d={back.line}
              pathLength={1}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="chart-draw"
            />
          </g>

          {front ? (
            <g>
              <path d={front.sheet} fill={`url(#${gFront})`} className="chart-fade-in" />
              <path
                d={front.line}
                pathLength={1}
                fill="none"
                stroke={overlayColor}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="chart-draw"
              />
            </g>
          ) : null}

          {/* A cut through both planes at the hovered period, so the two curtains can
              be read at the same moment in time despite standing apart. */}
          {active != null ? (
            <g>
              <line
                x1={project(active, scale.min, 0).x}
                y1={project(active, scale.min, 0).y}
                x2={project(active, scale.max, 1).x}
                y2={project(active, scale.max, 1).y}
                className="stroke-border"
                strokeWidth={1}
              />
              <circle
                cx={project(active, points[active].value, 1).x}
                cy={project(active, points[active].value, 1).y}
                r={4}
                fill={color}
                className="stroke-card"
                strokeWidth={1.5}
              />
              {hasOverlay ? (
                <circle
                  cx={project(active, points[active].second ?? 0, 0).x}
                  cy={project(active, points[active].second ?? 0, 0).y}
                  r={4}
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
                key={`lbl-${p.label}-${i}`}
                x={project(i, scale.min, 0).x}
                y={project(i, scale.min, 0).y + 16}
                textAnchor={i === 0 ? "start" : i >= n - stride ? "end" : "middle"}
                className="fill-muted-foreground text-[10px]"
              >
                {p.label}
              </text>
            ) : null,
          )}

          {points.map((p, i) => (
            <rect
              key={`hit-${p.label}-${i}`}
              x={PAD.left + xFor(i) - Math.max(6, plotW / n / 2)}
              y={PAD.top}
              width={Math.max(12, plotW / n)}
              height={height - PAD.top}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
            />
          ))}
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
          <div className="mt-0.5 flex items-baseline gap-2 text-sm">
            <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />
            <span className="text-xs text-muted-foreground">{valueLabel}</span>
            <span className="ml-auto font-medium tabular-nums">{fmtMoney(activePoint.value)}</span>
          </div>
          {hasOverlay ? (
            <div className="flex items-baseline gap-2 text-sm">
              <span
                className="size-2 rounded-full"
                style={{ background: overlayColor }}
                aria-hidden="true"
              />
              <span className="text-xs text-muted-foreground">{overlayLabel}</span>
              <span className="ml-auto font-medium tabular-nums">
                {fmtMoney(activePoint.second ?? 0)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
