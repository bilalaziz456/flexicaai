"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type ChartPoint = { label: string; value: number };

const HEIGHT = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

/** Smallest "nice" number ≥ v (1/2/5 × 10ⁿ), so the y-axis tops out cleanly. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Compact axis label: 1500 → 1.5k, 2_000_000 → 2M. */
function shortNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

const money = new Intl.NumberFormat("en-PK");

/** Path for a rectangle with only its top two corners rounded (bar anchored to baseline). */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/**
 * Single-series bar chart of net sales per time bucket (the title names the
 * series, so no legend). Measures its container for a crisp pixel layout, draws
 * recessive gridlines + a teal (`--chart-1`) bar per bucket with a 2px gap, and
 * shows a per-bar hover tooltip. Theme-aware through the design tokens.
 */
export function SalesChart({
  points,
  ariaLabel = "Net sales over time",
}: {
  points: ChartPoint[];
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const maxVal = points.reduce((m, p) => Math.max(m, p.value), 0);
  const top = niceCeil(maxVal);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(1, slot - 4); // 2px surface gap each side
  const yFor = (v: number) => PAD.top + plotH * (1 - v / top);

  // Thin out x labels so they never collide (~ one every ≥ 48px).
  const labelEvery = Math.max(1, Math.ceil((n * 48) / Math.max(plotW, 1)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));

  const hoverPoint = hover != null ? points[hover] : null;
  const hoverX = hover != null ? PAD.left + slot * hover + slot / 2 : 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
          onMouseLeave={() => setHover(null)}
        >
          {/* Recessive gridlines + y labels */}
          {ticks.map((t) => {
            const y = yFor(t);
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {shortNum(t)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {points.map((p, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const h = baseY - yFor(p.value);
            const dim = hover != null && hover !== i;
            return (
              <g key={i}>
                {p.value > 0 && (
                  <path
                    d={topRoundedRect(x, yFor(p.value), barW, h, 4)}
                    className="fill-[var(--color-chart-1)] transition-opacity"
                    opacity={dim ? 0.45 : 1}
                  />
                )}
                {/* Full-height hit target for a comfortable hover zone */}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
                {i % labelEvery === 0 && (
                  <text
                    x={PAD.left + slot * i + slot / 2}
                    y={baseY + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={baseY}
            y2={baseY}
            className="stroke-border"
            strokeWidth={1}
          />
        </svg>
      )}

      {/* Hover tooltip */}
      {hoverPoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: hoverX, top: yFor(hoverPoint.value) - 8 }}
        >
          <div className="font-medium">{hoverPoint.label}</div>
          <div className="text-muted-foreground">Rs {money.format(hoverPoint.value)}</div>
        </div>
      )}
    </div>
  );
}
