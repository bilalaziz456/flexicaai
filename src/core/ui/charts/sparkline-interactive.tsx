"use client";

import { useCallback, useState } from "react";
import { closeToBaseline, money, smoothPath, type Pt } from "@/core/ui/charts/geometry";
import { cn } from "@/core/lib/utils";

/**
 * The KPI sparkline, with a hover.
 *
 * The plain `Sparkline` stays and is still the default: it is static SVG, so a page
 * of server-rendered cards ships no JavaScript for it. This one is for the cards worth
 * interrogating — you put the pointer on the line and the card's own figure is
 * replaced by the value under your finger, then falls back when you leave.
 *
 * THE READOUT REPLACES THE FIGURE rather than floating a tooltip over it. A 28px-tall
 * trace has no room for a popup that does not cover the thing it describes, and a card
 * already has a perfectly good place to show a number — the place the number is.
 *
 * Nearest-x tracking, like the full charts: with thirty daily points the hit zones are
 * four pixels wide, and per-point rectangles make the value flicker between neighbours
 * as the pointer moves.
 */
export function InteractiveSparkline({
  values,
  labels,
  valueFormat = "money",
  color = "var(--color-chart-1)",
  height = 32,
  onActiveChange,
  ariaLabel = "Trend",
  className,
}: {
  values: number[];
  /** One per value — what the readout calls each point ("12 Sept"). */
  labels?: string[];
  /** Named, not a function: a SERVER card renders this, and a function cannot cross
   *  that boundary (it fails the render outright rather than degrading). */
  valueFormat?: "money" | "count";
  color?: string;
  height?: number;
  /** Told the active index, so the CARD can show the value in its own figure slot. */
  onActiveChange?: (index: number | null) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 120;
  const H = 32;
  const P = 3;

  const vals = values.length ? values : [0, 0];
  const n = vals.length;
  const max = Math.max(...vals);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (W - 2 * P) * (i / (n - 1)));
  const y = (v: number) => P + (H - 2 * P) * (1 - (v - min) / range);

  const pts: Pt[] = vals.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const area = closeToBaseline(line, pts, H);
  const gradId = `spark-i-${color.replace(/[^a-z0-9]/gi, "")}`;

  const move = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      // The viewBox is stretched to the card, so the pointer's fraction ACROSS the
      // element is the fraction across the data — no unit conversion needed.
      const frac = (e.clientX - rect.left) / (rect.width || 1);
      const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
      setActive(i);
      onActiveChange?.(i);
    },
    [n, onActiveChange],
  );
  const leave = useCallback(() => {
    setActive(null);
    onActiveChange?.(null);
  }, [onActiveChange]);

  const marker = active ?? n - 1;

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="w-full touch-pan-y"
        style={{ color, height }}
        onPointerMove={move}
        onPointerLeave={leave}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} className="chart-fade-in" />
        <path
          d={line}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="chart-draw"
        />
        {active != null ? (
          <line
            x1={x(active)}
            y1={0}
            x2={x(active)}
            y2={H}
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {n > 1 ? (
          // A zero-length round-capped line, not a circle: `preserveAspectRatio="none"`
          // stretches the viewBox, which would squash a circle into an ellipse.
          <line
            x1={x(marker)}
            y1={y(vals[marker])}
            x2={x(marker)}
            y2={y(vals[marker])}
            stroke="currentColor"
            strokeWidth={active != null ? 6 : 4.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="transition-all"
          />
        ) : null}
      </svg>
      {/* The readout sits ABOVE the trace, in the gap the card already leaves. A
          tooltip over a 28px line would cover the line it describes. */}
      {active != null ? (
        <span className="pointer-events-none absolute -top-4 right-0 text-2xs tabular-nums text-muted-foreground">
          {labels?.[active] ? `${labels[active]} · ` : ""}
          <span className="font-medium text-foreground">
            {valueFormat === "money"
              ? money(vals[active])
              : Math.round(vals[active]).toLocaleString("en-PK")}
          </span>
        </span>
      ) : null}
    </div>
  );
}
