"use client";

import { useState } from "react";
import { money as fmtMoney } from "@/core/ui/charts/geometry";
import { cn } from "@/core/lib/utils";

export type Slice = { label: string; value: number; color?: string };

/** The categorical ramp. Ordered so neighbouring slices never sit adjacent in hue. */
const RAMP = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
];

/**
 * COMPOSITION — what a total is made of: expenses by category, revenue by doctor,
 * how a clinic's months fall across payer bands.
 *
 * A ring, not a pie: the hole carries the total, which is the number a reader wants
 * first and would otherwise sit in a heading somewhere else on the card. And a ring
 * compares arc LENGTH, which people read more reliably than the wedge AREA a pie
 * asks them to judge.
 *
 * The rule for using this at all: only for parts of ONE whole, only when the parts
 * are few. Past about six the arcs stop being distinguishable and a ranked bar list
 * is the honest form — so the caller passes the top N and a folded "Other" slice
 * rather than thirty slivers.
 *
 * Every slice is named in the legend beside its figure and its share. Colour is
 * never the only carrier of identity.
 */
export function DonutChart({
  slices,
  total: totalOverride,
  centerLabel = "Total",
  formatValue = fmtMoney,
  size = 168,
  legend = true,
  ariaLabel,
  className,
}: {
  slices: Slice[];
  /** Defaults to the sum of the slices; pass one only when the whole is bigger. */
  total?: number;
  centerLabel?: string;
  formatValue?: (v: number) => string;
  size?: number;
  /** Off when the caller renders a richer legend of its own — the payer-band
   *  scorecard lists every band including the ones with no months, which says
   *  something a legend built from the slices cannot. */
  legend?: boolean;
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

  const stroke = Math.max(14, Math.round(size * 0.11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const GAP = rows.length > 1 ? 2 : 0; // a hairline between neighbouring arcs

  // Built with a plain loop, not a `map` that advances a running offset: mutating a
  // captured variable inside a render callback is exactly what the React compiler
  // refuses, and it is right to — the same `map` re-run against a memoised render
  // would start from wherever the last one left off.
  const arcs: {
    label: string;
    value: number;
    color: string;
    frac: number;
    dash: string;
    rotate: number;
  }[] = [];
  let offset = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const frac = s.value / sum;
    const len = Math.max(0, c * frac - GAP);
    arcs.push({
      label: s.label,
      value: s.value,
      color: s.color ?? RAMP[i % RAMP.length],
      frac,
      dash: `${len} ${c - len}`,
      // −90° so the first slice starts at twelve o'clock, where a reader starts.
      rotate: (offset / c) * 360 - 90,
    });
    offset += c * frac;
  }

  const shown = active != null ? arcs[active] : null;

  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={ariaLabel} className="-rotate-0">
          <g transform={`translate(${size / 2}, ${size / 2})`}>
            <circle
              r={r}
              fill="none"
              className="stroke-muted"
              strokeWidth={stroke}
              opacity={0.35}
            />
            {arcs.map((a, i) => (
              <circle
                key={`${a.label}-${i}`}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={active === i ? stroke + 3 : stroke}
                strokeDasharray={a.dash}
                strokeLinecap="butt"
                transform={`rotate(${a.rotate})`}
                opacity={active == null || active === i ? 1 : 0.35}
                className="chart-grow transition-all duration-200"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>
        {/* The hole is not decoration — it is where the total lives. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {shown ? shown.label : centerLabel}
          </span>
          <span className="mt-0.5 text-lg leading-tight font-semibold tabular-nums">
            {shown ? `${Math.round(shown.frac * 100)}%` : formatValue(total)}
          </span>
          {shown ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatValue(shown.value)}
            </span>
          ) : null}
        </div>
      </div>

      {legend ? (
      <ul className="min-w-0 flex-1 space-y-1.5 self-stretch">
        {arcs.map((a, i) => (
          <li
            key={`${a.label}-${i}`}
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
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(a.frac * 100)}%
            </span>
            <span className="w-24 shrink-0 text-right font-medium tabular-nums">
              {formatValue(a.value)}
            </span>
          </li>
        ))}
      </ul>
      ) : null}
    </div>
  );
}
