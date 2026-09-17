/**
 * Chart geometry and number formatting — the shared maths behind every chart in the
 * app, so a curve, a tick and a rupee look the same wherever they are drawn.
 *
 * PURE and dependency-free: no React, no DOM, no `server-only`. A server component
 * can lay out a sparkline with it, and the interactive charts use the same functions
 * for the same numbers, which is what stops two charts of one metric disagreeing.
 */

/** A rounded "nice" ceiling for an axis top: 1/2/5 × a power of ten. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Compact money for an axis tick or a dense label: 1.2M, 48k, 940. */
export function shortNum(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${sign}${Math.round(a)}`;
}

const pkr = new Intl.NumberFormat("en-PK");

/** "Rs 48,240" — the app's money rendering, used by every chart tooltip. */
export function money(n: number): string {
  return `${n < 0 ? "−" : ""}Rs ${pkr.format(Math.abs(Math.round(n)))}`;
}

/** "+18.4%" / "−3.2%". Returns null when there is no comparable baseline, so a
 *  caller cannot accidentally render ∞% or a percentage of nothing. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type Pt = { x: number; y: number };

/**
 * A smooth path through every point, using MONOTONE CUBIC interpolation
 * (Fritsch–Carlson).
 *
 * The curve matters more here than it looks. A plain Catmull-Rom or a fixed-tension
 * bezier — the usual "smooth line" one-liner — OVERSHOOTS: between a low point and a
 * high one it swings past both. On money that is not a cosmetic difference, it draws
 * revenue the clinic never took, and after a zero day it dips the curve BELOW zero,
 * which on the P&L chart paints a loss that did not happen. Monotone cubic is the
 * variant that cannot: it flattens the tangent at every local extreme, so the curve
 * stays inside the data's own range and a zero is a zero.
 *
 * Falls back to straight segments for fewer than three points, where there is no
 * curvature to infer and inventing some would be a lie about the shape.
 */
export function smoothPath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${r(pts[0].x)},${r(pts[0].y)}`;
  if (n === 2) return `M${r(pts[0].x)},${r(pts[0].y)} L${r(pts[1].x)},${r(pts[1].y)}`;

  // Secant slopes between consecutive points.
  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    dy.push(pts[i + 1].y - pts[i].y);
    slope.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  // Tangents: average of neighbouring secants, ZEROED at a sign change (that is the
  // local max/min, and a non-zero tangent there is exactly what overshoots).
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  // Fritsch–Carlson limiter: keep each tangent inside 3× its secant, which is the
  // condition for the cubic to stay monotone on that interval.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = (3 / Math.sqrt(s)) * slope[i];
      m[i] = t * a;
      m[i + 1] = t * b;
    }
  }

  let d = `M${r(pts[0].x)},${r(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${r(pts[i].x + h)},${r(pts[i].y + m[i] * h)} ${r(pts[i + 1].x - h)},${r(
      pts[i + 1].y - m[i + 1] * h,
    )} ${r(pts[i + 1].x)},${r(pts[i + 1].y)}`;
  }
  return d;
}

/** Straight polyline — for data where the between-points shape is meaningless. */
export function linePath(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${r(p.x)},${r(p.y)}`).join(" ");
}

/** Close a line path down to a baseline, making it fillable as an area. */
export function closeToBaseline(path: string, pts: readonly Pt[], baseY: number): string {
  if (!pts.length || !path) return "";
  return `${path} L${r(pts[pts.length - 1].x)},${r(baseY)} L${r(pts[0].x)},${r(baseY)} Z`;
}

/**
 * A value axis on ROUND numbers: picks a 1/2/5 × 10ⁿ step, then extends the range out
 * to whole multiples of it.
 *
 * Slicing the raw data range into equal parts instead — the obvious way — produces an
 * axis labelled −25k, 150k, 325k, 500k. Every one of those is arithmetically correct
 * and none of them is a number anybody thinks in, so the reader stops reading the
 * chart and starts decoding the axis. Snapping to the step also makes ZERO a tick
 * whenever the range crosses it, which the profit chart depends on: its baseline has
 * to be a line the axis actually names.
 */
export function niceScale(
  lo: number,
  hi: number,
  targetTicks = 4,
): { min: number; max: number; ticks: number[] } {
  const low = Math.min(lo, 0);
  const high = Math.max(hi, 0);
  const span = high - low;
  if (span <= 0) return { min: 0, max: 1, ticks: [0, 1] };

  const raw = span / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  // Guard the loop on a count as well as the bound: accumulated float error on a
  // small step could otherwise stop one tick short, or not at all.
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) ticks.push(min + i * step);
  return { min, max: max === min ? min + step : max, ticks };
}

/**
 * Evenly spaced ticks for an axis running `min…max`, always including both ends and
 * zero when the range crosses it. Kept for callers that have already fixed their
 * bounds; prefer `niceScale`, which chooses the bounds so the labels come out round.
 */
export function ticksFor(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(min + (span * i) / count);
  if (min < 0 && max > 0 && !out.some((t) => Math.abs(t) < span / 1000)) out.push(0);
  return out.sort((a, b) => a - b);
}

/** How many labels fit: shows every Nth so they never collide or overlap. */
export function labelStride(n: number, plotWidth: number, minPx = 56): number {
  if (n <= 1 || plotWidth <= 0) return 1;
  return Math.max(1, Math.ceil((n * minPx) / plotWidth));
}

/** Round to 2dp for a compact path string (SVG does not need more). */
function r(v: number): number {
  return Math.round(v * 100) / 100;
}
