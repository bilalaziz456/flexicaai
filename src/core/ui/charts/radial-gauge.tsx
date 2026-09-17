import { cn } from "@/core/lib/utils";

/**
 * RADIAL GAUGE — one rate, against the 100% it is a share of: an on-time payment
 * rate, a no-show rate, a margin.
 *
 * The difference from `DonutChart` is what the ring MEANS. A donut's arcs are parts
 * of each other and add to the whole; here there is one value and the empty track is
 * the rest of the target. Using a donut for this would imply a second category called
 * "not on time" that nobody measures.
 *
 * A ring rather than a bar because the number is the point — the hole gives it a place
 * to sit at a size you can read across a room, which a 6px progress bar does not.
 *
 * Server component: no measuring, no state, so a scorecard full of these ships no
 * client JavaScript.
 */
export function RadialGauge({
  value,
  label,
  color = "var(--color-chart-1)",
  size = 76,
  caption,
  className,
}: {
  /** 0–1. Clamped, so a bad input cannot draw an arc past the ring. */
  value: number;
  /** The accessible name — what the percentage is OF. */
  label: string;
  color?: string;
  size?: number;
  /** A word under the figure, inside the ring. */
  caption?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const stroke = Math.max(6, Math.round(size * 0.1));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(v * 100)}%`}
    >
      <svg width={size} height={size}>
        <g transform={`translate(${size / 2}, ${size / 2})`}>
          <circle
            r={r}
            fill="none"
            className="stroke-muted"
            strokeWidth={stroke}
            opacity={0.5}
          />
          {/* −90° so it fills clockwise from twelve o'clock. A round cap on a value
              near zero would still show a visible stub, so it is butt-capped until
              there is an arc worth rounding. */}
          <circle
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap={v > 0.04 ? "round" : "butt"}
            strokeDasharray={`${c * v} ${c}`}
            transform="rotate(-90)"
            className="chart-grow"
          />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums"
          style={{ fontSize: Math.max(12, Math.round(size * 0.22)) }}
        >
          {Math.round(v * 100)}%
        </span>
        {caption ? (
          <span className="text-[9px] tracking-wide text-muted-foreground uppercase">
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}
