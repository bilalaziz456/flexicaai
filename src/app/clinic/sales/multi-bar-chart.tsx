"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** One series in a grouped bar chart. `status` colours the bar by sign (good/loss). */
export type BarSeries = { key: string; label: string; color: string; status?: boolean };
export type MultiBarPoint = { label: string; values: Record<string, number> };

const HEIGHT = 280;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const GOOD = "#10b981"; // emerald-500 — positive profit
const BAD = "#ef4444"; // red-500 — loss
const money = new Intl.NumberFormat("en-PK");

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function shortNum(n: number): string {
  const s = Math.sign(n);
  const a = Math.abs(n);
  const body = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k` : String(a);
  return s < 0 ? `−${body}` : body;
}
/** Rect with the two corners AWAY from the zero baseline rounded. */
function barPath(x: number, w: number, yTop: number, yBottom: number, up: boolean): string {
  const h = yBottom - yTop;
  const r = Math.min(3, w / 2, h);
  if (h <= 0) return "";
  return up
    ? `M${x},${yBottom} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBottom} Z`
    : `M${x},${yTop} L${x},${yBottom - r} Q${x},${yBottom} ${x + r},${yBottom} L${x + w - r},${yBottom} Q${x + w},${yBottom} ${x + w},${yBottom - r} L${x + w},${yTop} Z`;
}

const barColor = (s: BarSeries, v: number) => (s.status ? (v < 0 ? BAD : GOOD) : s.color);

/**
 * Grouped multi-series bar chart with a zero baseline (draws negative bars below the
 * axis — needed for net loss / paid-over-earned). A legend names the series (identity
 * is never colour-alone), and a per-bucket hover tooltip lists every series. A `status`
 * series is coloured by sign (emerald ≥ 0, red < 0). Theme-aware via design tokens.
 */
export function MultiBarChart({
  points,
  series,
  ariaLabel,
}: {
  points: MultiBarPoint[];
  series: BarSeries[];
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  let maxV = 0;
  let minV = 0;
  for (const p of points) for (const s of series) {
    const v = p.values[s.key] ?? 0;
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
  }
  const top = niceCeil(maxV);
  const bottom = minV < 0 ? -niceCeil(-minV) : 0;
  const span = top - bottom || 1;

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + plotH * (1 - (v - bottom) / span);
  const zeroY = yFor(0);

  const slot = n > 0 ? plotW / n : 0;
  const groupW = Math.max(1, slot - 6); // 3px gutter each side of a group
  const barW = Math.max(1, groupW / Math.max(series.length, 1) - 2);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(bottom + span * f));
  const labelEvery = Math.max(1, Math.ceil((n * 48) / Math.max(plotW, 1)));
  const hoverPoint = hover != null ? points[hover] : null;

  return (
    <div className="w-full">
      {/* Legend */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: s.status ? GOOD : s.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ul>

      <div ref={wrapRef} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => {
              const y = yFor(t);
              return (
                <g key={t}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
                    {shortNum(t)}
                  </text>
                </g>
              );
            })}

            {points.map((p, i) => {
              const gx = PAD.left + slot * i + (slot - groupW) / 2;
              const dim = hover != null && hover !== i;
              return (
                <g key={i} opacity={dim ? 0.45 : 1} className="transition-opacity">
                  {series.map((s, si) => {
                    const v = p.values[s.key] ?? 0;
                    if (v === 0) return null;
                    const x = gx + si * (barW + 2);
                    const up = v >= 0;
                    const yV = yFor(v);
                    const d = up ? barPath(x, barW, yV, zeroY, true) : barPath(x, barW, zeroY, yV, false);
                    return <path key={s.key} d={d} style={{ fill: barColor(s, v) }} />;
                  })}
                  <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % labelEvery === 0 && (
                    <text x={PAD.left + slot * i + slot / 2} y={PAD.top + plotH + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                      {p.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Zero baseline (emphasised) */}
            <line x1={PAD.left} x2={width - PAD.right} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/50" strokeWidth={1} />
          </svg>
        )}

        {hoverPoint && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
            <div className="mb-0.5 font-medium">{hoverPoint.label}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: barColor(s, hoverPoint.values[s.key] ?? 0) }} aria-hidden="true" />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular-nums">Rs {money.format(hoverPoint.values[s.key] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
