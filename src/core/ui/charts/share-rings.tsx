"use client";

import { useId, useState } from "react";
import { money as fmtMoney } from "@/core/ui/charts/geometry";
import { cn } from "@/core/lib/utils";

export type ShareRow = { label: string; value: number };

/**
 * SHARE RINGS — how a total divides across a handful of named people, as one ring
 * each rather than one pie between them.
 *
 * WHY NOT A DONUT, which is what this replaced. A donut cuts a single circle into
 * wedges, so each wedge starts wherever the previous one ended and the reader is
 * asked to compare arcs that begin at different angles. On this page the shares come
 * out near-equal — 36 / 34 / 30 — and at those sizes nobody can rank three wedges by
 * eye; the donut becomes a decoration wrapped around a legend that does the real work.
 *
 * Every ring here starts at TWELVE O'CLOCK. That common baseline is the whole idea:
 * two shares are compared as two arcs swept from the same origin, which is the same
 * reason a bar chart aligns its bars on one axis. Ranking becomes reading.
 *
 * It also fixes what the donut wasted — the hole now carries the TOTAL, and takes the
 * hovered person's own figures when there is one, so the middle of the object is never
 * dead space.
 *
 * TWO MODES, ONE SYSTEM. `mode="depth"` keeps the identical geometry — same rings,
 * same angles, same colours — and lifts each ring to an elevation set by its share, on
 * a base plane, with a shadow beneath it. Depth is a SECOND reading of the same
 * quantity rather than a camera angle applied to a flat picture: the tallest ring is
 * the largest share, which is true from any distance. That is the difference between
 * dimensional design and a tilted chart.
 *
 * Honest about its limits: in depth mode the rings are drawn on an ellipse, so an arc
 * is foreshortened at the sides. The exact figures live in the cards beside the object
 * and in the centre, and both modes share one hover state, so a ring and its card
 * always light up together.
 */

const RAMP = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
];

/** Tilt for depth mode. Shallow on purpose — enough to read as a plane, not a squash. */
const TILT = 0.4;
/** How far the biggest share floats above the base, in px. */
const LIFT = 46;

/**
 * An elliptical arc starting at TWELVE O'CLOCK and sweeping `frac` of the way round.
 *
 * Written as a real path rather than a dashed <ellipse>, because the dash trick only
 * works on a circle: moving the start to the top means rotating the shape, and
 * rotating an ellipse by -90 swaps which axis is wide — the rings came out as
 * vertical blades. A path also makes the arc EXACTLY the share, where a dash on an
 * ellipse has to guess at a perimeter that has no closed form.
 */
function arcPath(cx: number, cy: number, rx: number, ry: number, frac: number): string {
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  const sweep = Math.min(frac, 0.9999) * 360;
  const s = at(0);
  // A single arc command cannot express a full turn (start and end coincide), so a
  // near-complete share is drawn in two halves.
  if (sweep > 180) {
    const m = at(sweep / 2);
    const e = at(sweep);
    return `M${s.x},${s.y} A${rx},${ry} 0 0 1 ${m.x},${m.y} A${rx},${ry} 0 0 1 ${e.x},${e.y}`;
  }
  const e = at(sweep);
  return `M${s.x},${s.y} A${rx},${ry} 0 0 1 ${e.x},${e.y}`;
}

type Ring = {
  label: string;
  value: number;
  frac: number;
  color: string;
  r: number;
};

export function ShareRings({
  rows,
  total: totalOverride,
  centerLabel = "Total",
  unitLabel,
  className,
}: {
  rows: ShareRow[];
  total?: number;
  centerLabel?: string;
  /** e.g. "3 doctors" — the sub-line under the total. */
  unitLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [depth, setDepth] = useState(false);
  const uid = useId();

  const positive = rows.filter((r) => r.value > 0);
  const sum = positive.reduce((a, r) => a + r.value, 0);
  const total = totalOverride ?? sum;

  if (positive.length === 0 || sum <= 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nothing recorded yet.
      </p>
    );
  }

  // Largest first, so the outermost ring is the biggest share and the object reads
  // from the outside in.
  const sorted = [...positive].sort((a, b) => b.value - a.value);

  const SIZE = 300;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const OUTER = SIZE / 2 - 14;
  const HOLE = 62;
  const band = Math.min(18, (OUTER - HOLE) / sorted.length);
  const stroke = Math.max(7, band - 7);

  const rings: Ring[] = sorted.map((r, i) => ({
    label: r.label,
    value: r.value,
    frac: r.value / sum,
    color: RAMP[i % RAMP.length],
    r: OUTER - i * band,
  }));

  // Lift is scaled against the biggest share, so the tallest ring is always the
  // leader and the object's height means the same thing whatever the spread.
  const topFrac = Math.max(...rings.map((r) => r.frac));
  const shown = active != null ? rings[active] : null;

  return (
    <div className={cn("@container", className)}>
      {/* The switch sits ON the visualisation's own header row rather than floating in
          the card corner, so it reads as part of the object it controls. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-2xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          {depth ? "Elevation = share" : "Arc from twelve o'clock = share"}
        </div>
        <div className="inline-flex rounded-full border border-border/70 bg-muted/40 p-0.5 backdrop-blur-sm">
          {[
            { on: false, text: "2D" },
            { on: true, text: "3D" },
          ].map((opt) => (
            <button
              key={opt.text}
              type="button"
              onClick={() => setDepth(opt.on)}
              aria-pressed={depth === opt.on}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-all duration-300",
                depth === opt.on
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.text}
              <span className="sr-only"> view</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 @2xl:grid-cols-[auto_1fr] @2xl:gap-10">
        <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={`${centerLabel} ${fmtMoney(total)}, split across ${rings.length}`}
            className="overflow-visible"
            onPointerLeave={() => setActive(null)}
          >
            <defs>
              {rings.map((ring, i) => (
                <linearGradient
                  key={`g-${i}`}
                  id={`${uid}-g${i}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0%" stopColor={ring.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={ring.color} stopOpacity={1} />
                </linearGradient>
              ))}
              <filter id={`${uid}-soft`} x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity="0.28" />
              </filter>
            </defs>

            {depth ? (
              // ── DEPTH: the same rings, each floating at its own share-height ──
              <g transform="translate(0, 26)">
                {/* The plate everything stands over. */}
                <ellipse
                  cx={cx}
                  cy={cy + LIFT * 0.55}
                  rx={OUTER + 6}
                  ry={(OUTER + 6) * TILT}
                  className="fill-muted-foreground/[0.07]"
                />
                {[...rings].reverse().map((ring, ri) => {
                  const i = rings.length - 1 - ri;
                  const lift = LIFT * (ring.frac / topFrac);
                  const y = cy + LIFT * 0.55 - lift - (active === i ? 10 : 0);
                  const floorY = cy + LIFT * 0.55 + 2;
                  const dim = active != null && active !== i;
                  return (
                    <g
                      key={`d-${i}`}
                      opacity={dim ? 0.32 : 1}
                      className="transition-all duration-300"
                      onPointerEnter={() => setActive(i)}
                    >
                      {/* The shadow it casts on the plate — the only thing that makes
                          a floating object look like it is floating. */}
                      <path
                        d={arcPath(cx, floorY, ring.r, ring.r * TILT, ring.frac)}
                        fill="none"
                        className="stroke-foreground/10"
                        strokeWidth={stroke}
                        strokeLinecap="round"
                      />
                      {/* The ring's side, then its face: two strokes of ONE path,
                          offset. A band, without the second edge that makes an
                          extruded slab draw every peak twice. */}
                      <path
                        d={arcPath(cx, y + 5, ring.r, ring.r * TILT, ring.frac)}
                        fill="none"
                        stroke={ring.color}
                        strokeOpacity={0.4}
                        strokeWidth={stroke}
                        strokeLinecap="round"
                      />
                      <path
                        d={arcPath(cx, y, ring.r, ring.r * TILT, ring.frac)}
                        fill="none"
                        stroke={`url(#${uid}-g${i})`}
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        filter={active === i ? `url(#${uid}-soft)` : undefined}
                      />
                    </g>
                  );
                })}
              </g>
            ) : (
              // ── FLAT: concentric arcs, every one starting at twelve o'clock ──
              <g>
                {rings.map((ring, i) => {
                  const dim = active != null && active !== i;
                  return (
                    <g
                      key={`f-${i}`}
                      className="transition-opacity duration-300"
                      opacity={dim ? 0.3 : 1}
                      onPointerEnter={() => setActive(i)}
                    >
                      {/* The track: the whole circle this share is a part of. Without
                          it an arc has nothing to be a fraction OF. */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={ring.r}
                        fill="none"
                        className="stroke-muted"
                        strokeWidth={stroke}
                        opacity={0.4}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={ring.r}
                        fill="none"
                        stroke={`url(#${uid}-g${i})`}
                        strokeWidth={active === i ? stroke + 3 : stroke}
                        pathLength={1}
                        strokeDasharray={`${ring.frac} 1`}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${cx} ${cy})`}
                        filter={active === i ? `url(#${uid}-soft)` : undefined}
                        className="transition-all duration-300"
                        style={{
                          // Sweeps out from twelve o'clock on load rather than fading
                          // in, so the arc's LENGTH is what the eye is handed. The
                          // keyframe reads this variable, so each ring starts from its
                          // own length rather than a guessed pixel offset.
                          ["--sweep" as string]: ring.frac,
                          animation: `share-sweep 900ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms both`,
                        }}
                      />
                    </g>
                  );
                })}
              </g>
            )}
          </svg>

          {/* The centre. Never dead space: the total, or whoever is under the pointer. */}
          {/* The readout sits in the hole when the rings are flat, and DOWN ON THE
              PLATE when they lift — in depth mode the arcs sweep through the middle of
              the box, and a total printed under an arc is a total nobody can read. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 flex flex-col items-center text-center transition-all duration-500",
              depth ? "justify-end pb-7" : "justify-center",
            )}
          >
            <span className="text-2xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {shown ? shown.label : centerLabel}
            </span>
            <span className="mt-1 text-xl leading-none font-semibold tabular-nums">
              {shown ? `${Math.round(shown.frac * 100)}%` : fmtMoney(total)}
            </span>
            <span className="mt-1 text-xs text-muted-foreground tabular-nums">
              {shown ? fmtMoney(shown.value) : unitLabel}
            </span>
          </div>
        </div>

        {/* The cards. Not a legend — a ranked list that happens to share the colours,
            with the same hover as the rings, so pointing at either lights both. */}
        <ul className="flex flex-col justify-center gap-2.5">
          {rings.map((ring, i) => {
            const dim = active != null && active !== i;
            return (
              <li key={`${ring.label}-${i}`}>
                <button
                  type="button"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-300",
                    active === i
                      ? "border-border bg-muted/50 shadow-sm"
                      : "border-transparent bg-muted/20",
                    dim && "opacity-45",
                  )}
                >
                  {/* A rail, not a dot: it is the same shape as the ring it points to. */}
                  <span
                    className="h-9 w-1 shrink-0 rounded-full transition-all duration-300"
                    style={{
                      background: ring.color,
                      height: active === i ? 44 : 36,
                    }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
                      {ring.label}
                    </span>
                    <span className="mt-0.5 block text-lg leading-none font-semibold tabular-nums">
                      {Math.round(ring.frac * 100)}%
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-medium tabular-nums">
                    {fmtMoney(ring.value)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
