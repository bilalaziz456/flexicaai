"use client";

import { useState } from "react";
import { money as fmtMoney } from "@/core/ui/charts/geometry";
import { cn } from "@/core/lib/utils";
import type { Slice } from "@/core/ui/charts/donut-chart";

/**
 * A THREE-DIMENSIONAL donut, built for side-by-side comparison against the flat one.
 *
 * ⚠ READ THIS BEFORE USING IT ANYWHERE ELSE. It is deliberately not the default, and
 * `conventions.md` tells you to reach for `DonutChart` instead, because the tilt costs
 * the chart the one thing a composition chart is for — proportion:
 *
 *  - **Perspective shrinks the back.** The ring is squashed to `TILT` of its height, so
 *    a slice at the top of the ellipse covers fewer pixels than an identical slice at
 *    the bottom. Two doctors on 20% each do not look equal.
 *  - **The extruded wall only exists at the front.** Slices in the near half gain the
 *    whole side face; slices at the back show none of it. That is area the reader adds
 *    to the value, and it is area the data did not ask for.
 *  - Together those two run the SAME direction, so a front slice is doubly
 *    overstated — which is why the research on 3D pies is so consistently unkind.
 *
 * It is drawn honestly within those limits: real arc geometry (not a decorative
 * swoosh), the same slice order and colours as the flat version, and every figure
 * still written in the legend, so the numbers remain true even where the shape is not.
 */

/** How far the ring is laid back. 1 = flat circle, 0.45 = a fairly aggressive tilt. */
const TILT = 0.45;
/** The extruded depth, in px. */
const DEPTH = 26;

const RAMP = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
];

/** A point on the tilted ellipse. Angles run clockwise from twelve o'clock. */
function pt(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

/** The flat top face of one slice, as an annular wedge on the ellipse. */
function topFace(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  inner: number,
  from: number,
  to: number,
): string {
  const large = to - from > 180 ? 1 : 0;
  const o1 = pt(cx, cy, rx, ry, from);
  const o2 = pt(cx, cy, rx, ry, to);
  const i2 = pt(cx, cy, rx * inner, ry * inner, to);
  const i1 = pt(cx, cy, rx * inner, ry * inner, from);
  return [
    `M${o1.x},${o1.y}`,
    `A${rx},${ry} 0 ${large} 1 ${o2.x},${o2.y}`,
    `L${i2.x},${i2.y}`,
    `A${rx * inner},${ry * inner} 0 ${large} 0 ${i1.x},${i1.y}`,
    "Z",
  ].join(" ");
}

/**
 * The outer side wall for the part of a slice that faces the viewer.
 *
 * Only the FRONT half of the ellipse (90°–270° in this coordinate system) has a
 * visible wall; anything behind the equator is hidden by the top face. Clipping the
 * slice to that window is what stops a back slice from painting a wall over its own
 * surface.
 */
function outerWall(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): string | null {
  const a = Math.max(from, 90);
  const b = Math.min(to, 270);
  if (b <= a) return null;
  const large = b - a > 180 ? 1 : 0;
  const p1 = pt(cx, cy, rx, ry, a);
  const p2 = pt(cx, cy, rx, ry, b);
  return [
    `M${p1.x},${p1.y}`,
    `A${rx},${ry} 0 ${large} 1 ${p2.x},${p2.y}`,
    `L${p2.x},${p2.y + DEPTH}`,
    `A${rx},${ry} 0 ${large} 0 ${p1.x},${p1.y + DEPTH}`,
    "Z",
  ].join(" ");
}

export function Donut3D({
  slices,
  total: totalOverride,
  centerLabel = "Total",
  size = 260,
  ariaLabel,
  className,
}: {
  slices: Slice[];
  total?: number;
  centerLabel?: string;
  size?: number;
  ariaLabel: string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const rows = slices.filter((s) => s.value > 0);
  const sum = rows.reduce((a, s) => a + s.value, 0);
  const total = totalOverride ?? sum;
  if (rows.length === 0 || sum <= 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nothing recorded for this period yet.
      </p>
    );
  }

  const w = size;
  const h = size * TILT + DEPTH + 16;
  const cx = w / 2;
  const cy = (size * TILT) / 2 + 8;
  const rx = size / 2 - 6;
  const ry = rx * TILT;
  const INNER = 0.56;

  const arcs: { s: Slice; color: string; from: number; to: number; frac: number }[] = [];
  let at = 0;
  for (let i = 0; i < rows.length; i++) {
    const frac = rows[i].value / sum;
    arcs.push({
      s: rows[i],
      color: rows[i].color ?? RAMP[i % RAMP.length],
      from: at,
      to: at + frac * 360,
      frac,
    });
    at += frac * 360;
  }

  const shown = active != null ? arcs[active] : null;

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={ariaLabel}
        className="max-w-full"
        onPointerLeave={() => setActive(null)}
      >
        {/* Walls first, back to front, so a near slice's wall covers a far one's. */}
        {arcs.map((a, i) => {
          const d = outerWall(cx, cy, rx, ry, a.from, a.to);
          if (!d) return null;
          return (
            <path
              key={`wall-${i}`}
              d={d}
              fill={a.color}
              // The wall is the same hue, darkened, so the solid reads as one object
              // lit from above rather than as two unrelated shapes.
              style={{ filter: "brightness(0.62)" }}
              opacity={active == null || active === i ? 1 : 0.4}
              onPointerEnter={() => setActive(i)}
            />
          );
        })}

        {arcs.map((a, i) => (
          <path
            key={`top-${i}`}
            d={topFace(cx, cy, rx, ry, INNER, a.from, a.to)}
            fill={a.color}
            opacity={active == null || active === i ? 1 : 0.4}
            className="stroke-card"
            strokeWidth={1}
            onPointerEnter={() => setActive(i)}
          />
        ))}

        <text
          x={cx}
          y={cy + 3}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] tracking-wide uppercase"
        >
          {centerLabel}
        </text>
      </svg>

      <ul className="w-full space-y-1.5">
        {arcs.map((a, i) => (
          <li
            key={`${a.s.label}-${i}`}
            className={cn(
              "flex items-baseline gap-2 rounded-md px-1.5 py-1 text-sm transition-colors",
              active === i && "bg-muted/60",
            )}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
          >
            <span
              className="size-2.5 shrink-0 translate-y-0.5 rounded-full"
              style={{ background: a.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{a.s.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(a.frac * 100)}%
            </span>
            <span className="w-24 shrink-0 text-right font-medium tabular-nums">
              {fmtMoney(a.s.value)}
            </span>
          </li>
        ))}
      </ul>
      <p className="w-full text-xs text-muted-foreground">
        {shown ? `${shown.s.label}: ${fmtMoney(shown.s.value)}` : `Total ${fmtMoney(total)}`}
      </p>
    </div>
  );
}
