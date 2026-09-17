"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * The billing page's trend chart: collected against billed, week by week, drawn as two
 * smooth lines with a soft area under the collected one.
 *
 * Interactive the way a finance chart should be: hover (or arrow keys, once focused)
 * moves a guide line and a tooltip to the nearest week and reads out both figures and
 * the gap between them — the gap being the point of the page. The lines draw themselves
 * the first time the chart scrolls into view.
 *
 * Hand-drawn SVG rather than a charting library: two series and a tooltip do not justify
 * a dependency (CLAUDE.md §2), and a library's own styles would fight the site's tokens.
 * The figures are a sample practice's, not anyone's books.
 */

type Point = { label: string; billed: number; collected: number };

const W = 640;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

/** Catmull-Rom through the points, as cubic Béziers — smooth without overshooting much. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

const rupees = (n: number) => `Rs ${n.toLocaleString("en-IN")}`;

export function RevenueChart({ data }: { data: Point[] }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(data.length - 1);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Nothing to animate: the lines are simply there.
      const t = window.setTimeout(() => setDrawn(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const max = Math.max(...data.map((p) => p.billed)) * 1.1;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (data.length - 1);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);

  const billedPts = data.map((p, i) => [x(i), y(p.billed)] as [number, number]);
  const collectedPts = data.map((p, i) => [x(i), y(p.collected)] as [number, number]);
  const billedPath = smoothPath(billedPts);
  const collectedPath = smoothPath(collectedPts);
  const area = `${collectedPath} L${x(data.length - 1)},${H - PAD.bottom} L${x(0)},${H - PAD.bottom} Z`;

  const point = data[active];
  const pct = (x(active) / W) * 100;

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "ArrowRight") setActive((a) => Math.min(data.length - 1, a + 1));
    else return;
    e.preventDefault();
  }

  const draw = (delay: number) => ({
    strokeDasharray: 1,
    strokeDashoffset: drawn ? 0 : 1,
    transition: `stroke-dashoffset 1.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
  });

  return (
    <div ref={ref} className="relative select-none">
      <div
        role="img"
        tabIndex={0}
        aria-label={`Collected against billed over ${data.length} weeks. ${point.label}: collected ${rupees(point.collected)} of ${rupees(point.billed)} billed. Use the arrow keys to move between weeks.`}
        onPointerMove={onMove}
        onKeyDown={onKey}
        className="relative cursor-crosshair rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" fill="none">
          <defs>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-teal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--brand-teal)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--brand-blue)" />
              <stop offset="100%" stopColor="var(--brand-teal)" />
            </linearGradient>
          </defs>

          {/* Faint gridlines at quarter heights. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
              y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
              stroke="currentColor"
              strokeOpacity="0.07"
              strokeDasharray="3 5"
            />
          ))}

          <path d={area} fill={`url(#${id}-area)`} style={{ opacity: drawn ? 1 : 0, transition: "opacity 1.2s ease 600ms" }} />
          <path d={billedPath} pathLength={1} stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" style={draw(0)} />
          <path
            d={collectedPath}
            pathLength={1}
            stroke={`url(#${id}-line)`}
            strokeWidth="3"
            strokeLinecap="round"
            style={draw(250)}
          />

          {/* Guide + markers for the active week. */}
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity="0.15" />
          <circle cx={x(active)} cy={y(point.billed)} r="4" fill="var(--card)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
          <circle cx={x(active)} cy={y(point.collected)} r="5.5" fill="var(--card)" stroke="var(--brand-teal)" strokeWidth="3" />

          {data.map((p, i) =>
            i % 2 === 0 || i === data.length - 1 ? (
              <text
                key={p.label}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                fill="currentColor"
                fillOpacity="0.45"
                fontSize="11"
              >
                {p.label}
              </text>
            ) : null,
          )}
        </svg>

        {/* Tooltip, kept inside the chart by clamping its anchor. On a phone it sits under
            the chart instead — floating, it would cover most of what it describes. */}
        <div
          aria-hidden="true"
          className="pointer-events-none mt-3 w-full rounded-xl sm:absolute sm:top-0 sm:mt-0 sm:w-44 sm:-translate-x-1/2 bg-background/95 p-3 text-left shadow-[0_0_0_1px_var(--mk-line-strong),var(--mk-shadow-lift)] backdrop-blur transition-[left] duration-200 ease-out"
          style={{ left: `clamp(5.5rem, ${pct}%, calc(100% - 5.5rem))` }}
        >
          <p className="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">{point.label}</p>
          <p className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-brand-teal" /> Collected
            </span>
            <span className="font-semibold tabular-nums">{rupees(point.collected)}</span>
          </p>
          <p className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-foreground/30" /> Billed
            </span>
            <span className="tabular-nums">{rupees(point.billed)}</span>
          </p>
          <p className="mt-2 border-t border-[var(--mk-line)] pt-2 text-3xs text-warning-text">
            {rupees(point.billed - point.collected)} still to collect
          </p>
        </div>
      </div>
    </div>
  );
}
