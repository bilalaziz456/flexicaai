"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** A waterfall step. `role`: start = anchored bar from 0 (Collected); deduct = a
 *  descending step (value is signed, usually negative); result = anchored total
 *  (Net profit, coloured by sign). */
export type WaterfallStep = { label: string; value: number; role: "start" | "deduct" | "result" };

const HEIGHT = 280;
const PAD = { top: 22, right: 12, bottom: 30, left: 56 };
const GOOD = "#10b981";
const BAD = "#ef4444";

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
function topRounded(x: number, w: number, yTop: number, yBot: number): string {
  const h = yBot - yTop;
  const r = Math.min(3, w / 2, Math.abs(h));
  if (h <= 0) return "";
  return `M${x},${yBot} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBot} Z`;
}

/**
 * Waterfall chart — the running story of how a total became a result (Collected →
 * −Doctor shares → −Expenses → Net profit). Anchored totals sit on the zero baseline;
 * deductions float between the running totals, linked by dashed connectors; the result
 * is green (profit) or red (loss). Each bar carries its value; a zero baseline handles
 * a negative result. Measures its container for a crisp layout; theme-aware.
 */
export function WaterfallChart({ steps, ariaLabel = "Money flow" }: { steps: WaterfallStep[]; ariaLabel?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build each bar's span (running total before it = the running after the prior step).
  const bars = steps.map((s, i, arr) => {
    const running = arr.slice(0, i).reduce((r, p) => (p.role === "deduct" ? r + p.value : p.value), 0);
    return s.role === "deduct" ? { ...s, from: running, to: running + s.value } : { ...s, from: 0, to: s.value };
  });

  const allY = bars.flatMap((b) => [b.from, b.to]).concat(0);
  const maxV = Math.max(...allY);
  const minV = Math.min(...allY);
  const top = niceCeil(maxV);
  const bottom = minV < 0 ? -niceCeil(-minV) : 0;
  const span = top - bottom || 1;

  const n = bars.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + plotH * (1 - (v - bottom) / span);
  const zeroY = yFor(0);
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(1, slot * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(bottom + span * f));

  const colorFor = (b: (typeof bars)[number]) =>
    b.role === "start" ? "var(--color-chart-1)" : b.role === "result" ? (b.value < 0 ? BAD : GOOD) : "var(--color-chart-4)";

  return (
    <div ref={wrapRef} className="w-full">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel}>
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

          {bars.map((b, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const yTop = yFor(Math.max(b.from, b.to));
            const yBot = yFor(Math.min(b.from, b.to));
            const labelY = yTop - 6;
            return (
              <g key={i}>
                {/* connector to the next bar at this bar's running level */}
                {i < n - 1 ? (
                  <line
                    x1={x + barW}
                    x2={PAD.left + slot * (i + 1) + (slot - barW) / 2}
                    y1={yFor(b.to)}
                    y2={yFor(b.to)}
                    className="stroke-muted-foreground/40"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                ) : null}
                <path d={topRounded(x, barW, yTop, yBot)} style={{ fill: colorFor(b) }} />
                <text x={x + barW / 2} y={labelY} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
                  {shortNum(b.value)}
                </text>
                <text x={x + barW / 2} y={PAD.top + plotH + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {b.label}
                </text>
              </g>
            );
          })}

          <line x1={PAD.left} x2={width - PAD.right} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/50" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}
