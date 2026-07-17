/**
 * Sparkline — a tiny, axis-less, word-sized trend chart to sit under a KPI number, so
 * a card shows both "how much" and "which way it's heading". Pure SVG with a fixed
 * viewBox stretched to the card width (`preserveAspectRatio="none"` + a non-scaling
 * stroke keeps the line crisp), so it needs no measuring and renders in a server
 * component. Colour flows from `color` via `currentColor` (line + faint fill).
 */
export function Sparkline({
  values,
  color = "var(--color-chart-1)",
  ariaLabel = "Trend",
}: {
  values: number[];
  color?: string;
  ariaLabel?: string;
}) {
  const W = 120;
  const H = 32;
  const P = 2;
  const vals = values.length ? values : [0, 0];
  const n = vals.length;
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (W - 2 * P) * (i / (n - 1)));
  const y = (v: number) => P + (H - 2 * P) * (1 - (v - min) / range);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className="h-8 w-full"
      style={{ color }}
    >
      <path d={area} fill="currentColor" fillOpacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
