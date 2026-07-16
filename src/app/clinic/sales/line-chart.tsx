"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type LineSeries = { key: string; label: string; color: string };
export type LinePoint = { label: string; values: Record<string, number> };

const HEIGHT = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const money = new Intl.NumberFormat("en-PK");

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function shortNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

/**
 * Multi-line chart (cumulative Earned vs Paid). A legend names each line; a crosshair
 * hover reads every series at that bucket. The gap between the two lines is the running
 * outstanding balance. Theme-aware via design tokens.
 */
export function LineChart({
  points,
  series,
  ariaLabel,
}: {
  points: LinePoint[];
  series: LineSeries[];
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
  for (const p of points) for (const s of series) maxV = Math.max(maxV, p.values[s.key] ?? 0);
  const top = niceCeil(maxV);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  const xFor = (i: number) => (n <= 1 ? PAD.left + plotW / 2 : PAD.left + (plotW * i) / (n - 1));
  const yFor = (v: number) => PAD.top + plotH * (1 - v / top);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const labelEvery = Math.max(1, Math.ceil((n * 48) / Math.max(plotW, 1)));
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverX = hover != null ? xFor(hover) : 0;

  return (
    <div className="w-full">
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: s.color }} aria-hidden="true" />
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

            {series.map((s) => {
              const d = points
                .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.values[s.key] ?? 0)}`)
                .join(" ");
              return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
            })}

            {/* x labels */}
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={xFor(i)} y={baseY + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {p.label}
                </text>
              ) : null,
            )}

            {/* Crosshair + markers on hover */}
            {hover != null && (
              <>
                <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={baseY} className="stroke-border" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.key} cx={hoverX} cy={yFor(hoverPoint!.values[s.key] ?? 0)} r={3.5} style={{ fill: s.color }} />
                ))}
              </>
            )}

            {/* Hit zones */}
            {points.map((p, i) => (
              <rect key={i} x={xFor(i) - slotHalf(plotW, n)} y={PAD.top} width={slotHalf(plotW, n) * 2} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}

            <line x1={PAD.left} x2={width - PAD.right} y1={baseY} y2={baseY} className="stroke-border" strokeWidth={1} />
          </svg>
        )}

        {hoverPoint && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{ left: Math.min(Math.max(hoverX, 60), width - 60), top: 4 }}
          >
            <div className="mb-0.5 font-medium">{hoverPoint.label}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden="true" />
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

/** Half the slot width, for a comfortable per-point hit zone. */
function slotHalf(plotW: number, n: number): number {
  return n > 1 ? plotW / (n - 1) / 2 : plotW / 2;
}
