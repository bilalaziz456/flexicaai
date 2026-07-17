"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

export type AreaPoint = { label: string; value: number };

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
 * Single-series filled AREA chart over time — the right form for a flow that
 * accumulates (collected revenue), where the trend/shape matters more than each
 * discrete period. A teal gradient fill under a 2px line, recessive gridlines, a
 * crosshair + tooltip on hover, and a dot on every point. Theme-aware via tokens.
 */
export function AreaChart({
  points,
  ariaLabel = "Value over time",
}: {
  points: AreaPoint[];
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradId = useId();
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
  const maxVal = points.reduce((m, p) => Math.max(m, p.value), 0);
  const top = niceCeil(maxVal);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  const xFor = (i: number) => (n <= 1 ? PAD.left + plotW / 2 : PAD.left + (plotW * i) / (n - 1));
  const yFor = (v: number) => PAD.top + plotH * (1 - v / top);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const labelEvery = Math.max(1, Math.ceil((n * 48) / Math.max(plotW, 1)));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.value)}`).join(" ");
  const area = n > 0 ? `${line} L${xFor(n - 1)},${baseY} L${xFor(0)},${baseY} Z` : "";
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverX = hover != null ? xFor(hover) : 0;
  const half = n > 1 ? plotW / (n - 1) / 2 : plotW / 2;

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

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

          {area ? <path d={area} fill={`url(#${gradId})`} /> : null}
          {line ? <path d={line} fill="none" stroke="var(--color-chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}

          {points.map((p, i) => (
            <circle key={i} cx={xFor(i)} cy={yFor(p.value)} r={hover === i ? 4 : 2.5} className="fill-[var(--color-chart-1)]" />
          ))}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={`l${i}`} x={xFor(i)} y={baseY + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {p.label}
              </text>
            ) : null,
          )}

          {hover != null ? <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={baseY} className="stroke-border" strokeWidth={1} /> : null}

          {points.map((p, i) => (
            <rect key={`h${i}`} x={xFor(i) - half} y={PAD.top} width={half * 2} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}

          <line x1={PAD.left} x2={width - PAD.right} y1={baseY} y2={baseY} className="stroke-border" strokeWidth={1} />
        </svg>
      )}

      {hoverPoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.min(Math.max(hoverX, 56), width - 56), top: 4 }}
        >
          <div className="font-medium">{hoverPoint.label}</div>
          <div className="text-muted-foreground">Rs {money.format(hoverPoint.value)}</div>
        </div>
      )}
    </div>
  );
}
