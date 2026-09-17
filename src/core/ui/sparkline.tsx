import { closeToBaseline, smoothPath, type Pt } from "@/core/ui/charts/geometry";

/**
 * Sparkline — a word-sized trend to sit under a KPI number, so a card says both "how
 * much" and "which way". Smooth monotone curve, a fill that fades to nothing, and a
 * dot on the latest point.
 *
 * Deliberately still PURE SVG with no measuring, so it renders in a server component
 * — that is what lets it sit in the dashboard's cards without turning each one into
 * a client island. Interaction belongs to the full chart the card links to; a
 * 32px-tall trace is not a thing you can meaningfully hover a value out of.
 *
 * THE LAST POINT IS THE POINT. The old version drew a bare line, which told you the
 * shape but not where it left you. The dot marks the current value, and `tone="auto"`
 * colours the whole trace by its direction, so a glance down a column of cards reads
 * as a set of directions rather than a set of squiggles.
 *
 * The gradient id is derived from the colour rather than `useId` (a hook, unavailable
 * in a server component). Two sparklines of the same colour therefore share one
 * definition — harmless, because that definition is identical.
 */
export function Sparkline({
  values,
  color = "var(--color-chart-1)",
  tone = "fixed",
  height = 32,
  showLast = true,
  ariaLabel = "Trend",
}: {
  values: number[];
  color?: string;
  /** "auto" colours by direction (up = success, down = destructive). */
  tone?: "fixed" | "auto";
  height?: number;
  showLast?: boolean;
  ariaLabel?: string;
}) {
  const W = 120;
  const H = 32;
  const P = 3;
  const vals = values.length ? values : [0, 0];
  const n = vals.length;

  const resolved =
    tone === "auto"
      ? vals[n - 1] >= vals[0]
        ? "var(--color-success)"
        : "var(--color-destructive)"
      : color;
  const gradId = `spark-${resolved.replace(/[^a-z0-9]/gi, "")}`;

  // THE SERIES' OWN RANGE, not zero-anchored. A sparkline has no axis, so it cannot
  // communicate magnitude — the figure above it does that — and all it has to offer is
  // SHAPE. Forcing zero into the scale destroys exactly that on any series that never
  // approaches zero: the outstanding-receivable card ran 1.60M to 1.70M and drew a dead
  // flat line across the top 6% of the box, hiding the only thing it was there to show.
  //
  // The cost is that a small wiggle fills the height, which is the classic sparkline
  // trade-off and the reason the exact number always sits directly above it.
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (W - 2 * P) * (i / (n - 1)));
  const y = (v: number) => P + (H - 2 * P) * (1 - (v - min) / range);

  const pts: Pt[] = vals.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const area = closeToBaseline(line, pts, H);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className="w-full"
      style={{ color: resolved, height }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {showLast && n > 1 ? (
        // `preserveAspectRatio="none"` stretches the viewBox, which would squash a
        // circle into an ellipse — so the marker is a non-scaling stroked dot: a
        // zero-length round-capped line keeps its shape whatever the card's width.
        <line
          x1={x(n - 1)}
          y1={y(vals[n - 1])}
          x2={x(n - 1)}
          y2={y(vals[n - 1])}
          stroke="currentColor"
          strokeWidth={4.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
