"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/core/lib/utils";

/**
 * The shared shell every interactive chart is built on — measuring, the tooltip, the
 * gradient, the empty state. One implementation so a hover, a surface and a curve
 * behave identically whether you are looking at clinic revenue or company P&L.
 *
 * Before this existed the app had four near-identical charts, each with its own copy
 * of the padding constants, the tick maths and a tooltip pinned to a different place.
 * That is how two charts of the same money end up disagreeing about what "k" means.
 */

/** Plot padding. `left` holds the value axis; `bottom` the period labels. */
export const PAD = { top: 14, right: 10, bottom: 26, left: 48 } as const;

/** Measures the container so the chart can be drawn at its real width. */
export function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Round: a sub-pixel resize would otherwise re-render the whole path on every
      // frame of a window drag.
      setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Tracks the pointer over the plot and reports the NEAREST index.
 *
 * Nearest-x rather than a per-point hit rect: with 90 daily buckets those rects are
 * three pixels wide and the tooltip flickers between neighbours. This way the chart
 * always has an answer for wherever the pointer is, which is what makes a crosshair
 * feel like it is tracking you rather than catching you.
 */
export function usePointerIndex(count: number, xFor: (i: number) => number) {
  const [active, setActive] = useState<number | null>(null);
  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (count === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < count; i++) {
        const d = Math.abs(xFor(i) - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      setActive(best);
    },
    [count, xFor],
  );
  const clear = useCallback(() => setActive(null), []);
  return { active, onMove, clear } as const;
}

/**
 * The floating tooltip. Follows the pointer horizontally and clamps to the container,
 * so a hover near either edge stays readable instead of hanging off the card.
 */
export function ChartTooltip({
  x,
  width,
  title,
  children,
}: {
  x: number;
  width: number;
  title: string;
  children: ReactNode;
}) {
  const W = 168;
  const left = Math.min(Math.max(x, W / 2 + 4), Math.max(width - W / 2 - 4, W / 2 + 4));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm"
      style={{ left, minWidth: W }}
      role="status"
    >
      <div className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

/** One measure inside a tooltip: a dot, its name, and the figure. */
export function TooltipRow({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: string;
  color?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {color ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
      ) : null}
      <span className={cn("text-xs", muted ? "text-muted-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "ml-auto font-medium tabular-nums",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A chart's key: which colour means what.
 *
 * ONE LEGEND FOR EVERY CHART, for the reason `core/ui` holds one of each primitive —
 * a swatch that is 10px on one chart and 8px on the next, or a row here and a column
 * there, makes two charts on one page look like two products. `DonutChart` keeps its
 * own richer legend on purpose (it carries each slice's share and value, which is the
 * donut's whole point); this is the plain key every other chart needs.
 *
 * IT RENDERS NOTHING BELOW TWO ITEMS, and that is the design. A legend exists to tell
 * encodings APART; with one series there is nothing to tell apart, so the legend can
 * only repeat the card title back at the reader. That is the same rule the charts
 * already follow for sparklines and deltas — show a thing when the thing exists
 * (conventions §6). A single-series chart names its measure in its heading.
 *
 * The swatches are `aria-hidden`: colour is not available to a screen reader, so the
 * LABELS are the content and the dots are decoration on top of them.
 */
export function ChartLegend({
  items,
  className,
}: {
  /** `dash` draws the swatch as a dashed rule instead of a dot — use it when the
   *  series itself is dashed, so the key LOOKS like the thing it explains. A solid
   *  dot standing for a dashed comparison line is a small lie the reader has to
   *  discover by squinting at the chart. */
  items: { label: string; color: string; dash?: boolean }[];
  className?: string;
}) {
  if (items.length < 2) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {it.dash ? (
            <span
              className="w-3.5 shrink-0 border-t-2 border-dashed"
              style={{ borderColor: it.color }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: it.color }}
              aria-hidden="true"
            />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Shown instead of an axis with nothing under it. A chart of no data is not a small
 * chart, it is a different thing to look at — and an empty plot reads as "broken"
 * where a sentence reads as "nothing happened yet".
 */
export function ChartEmpty({ message, height = 200 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 text-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {message}
    </div>
  );
}

/** Subtle horizontal grid + value labels. No vertical lines, no axis rule: the data
 *  is the drawing, and a boxed plot is what makes a chart look like a spreadsheet. */
export function Grid({
  ticks,
  yFor,
  width,
  format,
  zero,
}: {
  ticks: number[];
  yFor: (v: number) => number;
  width: number;
  format: (v: number) => string;
  /** Draw this value as the emphasised baseline (the P&L zero line). */
  zero?: number;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => {
        const y = yFor(t);
        const isZero = zero != null && Math.abs(t - zero) < 1e-9;
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y}
              y2={y}
              className={isZero ? "stroke-muted-foreground/35" : "stroke-border/50"}
              strokeWidth={1}
              strokeDasharray={isZero ? undefined : "2 5"}
            />
            <text
              x={PAD.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** A vertical gradient from a colour to nothing — the area fill under a curve. */
export function useGradient(): [string, (color: string, from?: number, to?: number) => ReactNode] {
  const id = useId();
  const def = (color: string, from = 0.28, to = 0) => (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
  return [id, def];
}
