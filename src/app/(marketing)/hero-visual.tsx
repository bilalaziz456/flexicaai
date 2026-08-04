/**
 * The hero artwork — the logo's own vocabulary redrawn at scale: the hexagon badge,
 * circuit traces, a vital-sign trace, and a constellation of nodes wired to each
 * other, all built from the brand tokens so it recolours itself in light and dark.
 *
 * Inline SVG rather than an image: it stays crisp at any size, costs no extra
 * request, and — the real reason — it is server-rendered, so the hero is complete in
 * the HTML with no client work at all. The only script involved is the parallax
 * wrapper, which just publishes two numbers.
 *
 * Three depth layers (`hero-depth-1/2/3`) lean toward the pointer by different
 * amounts, which is what turns a flat drawing into something with space in it. The
 * layer wrappers carry the parallax and their CHILDREN carry the spin — a CSS
 * animation and a CSS transform on the same element would fight, and the animation
 * would win.
 *
 * Purely decorative, so it is hidden from assistive tech. All motion is behind
 * `motion-safe:`; a visitor who asked for less gets the same picture, still.
 */
export function HeroVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative w-full select-none ${className ?? ""}`}>
      {/* Ambient brand glow behind the artwork. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_45%,var(--brand-teal)_0%,transparent_62%)] opacity-20 blur-2xl dark:opacity-30" />

      <svg viewBox="0 0 400 400" className="w-full overflow-visible" fill="none">
        <defs>
          <linearGradient id="fx-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-teal)" />
            <stop offset="55%" stopColor="var(--brand-blue)" />
            <stop offset="100%" stopColor="var(--brand-navy)" />
          </linearGradient>
          <linearGradient id="fx-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-teal)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--brand-blue)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* ---- far layer: the outer hexagon and the node constellation ---- */}
        <g className="hero-depth-1">
          <polygon
            points={hexPoints(200, 200, 168)}
            stroke="url(#fx-stroke)"
            strokeWidth="1.25"
            strokeOpacity="0.5"
            className="motion-safe:origin-center motion-safe:animate-[spin_64s_linear_infinite]"
          />

          {/* The round motif, folded in: nodes on a circle, chorded to each other so
              it reads as a network rather than a dial. Counter-rotates against the
              hexagons, which is what keeps the two shapes legible as two shapes. */}
          <g className="motion-safe:origin-center motion-safe:animate-[spin_46s_linear_infinite_reverse]">
            <circle
              cx="200"
              cy="200"
              r="148"
              stroke="url(#fx-stroke)"
              strokeWidth="1"
              strokeOpacity="0.28"
              strokeDasharray="2 9"
            />
            {CHORDS.map(([a, b], i) => {
              const p = ringPoint(a);
              const q = ringPoint(b);
              return (
                <line
                  key={i}
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  stroke="url(#fx-stroke)"
                  strokeWidth="0.9"
                  strokeOpacity="0.3"
                />
              );
            })}
            {RING_NODES.map((angle, i) => {
              const p = ringPoint(angle);
              return (
                <circle
                  key={angle}
                  cx={p.x}
                  cy={p.y}
                  r="3.2"
                  fill="var(--brand-teal)"
                  className="motion-safe:animate-pulse"
                  style={{ animationDelay: `${(i % 5) * 0.45}s`, animationDuration: "3.4s" }}
                />
              );
            })}
          </g>
        </g>

        {/* ---- mid layer: second hexagon and the circuit traces ---- */}
        <g className="hero-depth-2">
          <polygon
            points={hexPoints(200, 200, 128)}
            stroke="url(#fx-stroke)"
            strokeWidth="1"
            strokeOpacity="0.4"
            className="motion-safe:origin-center motion-safe:animate-[spin_52s_linear_infinite_reverse]"
          />
          <g
            stroke="url(#fx-stroke)"
            strokeOpacity="0.45"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <path d="M200 32 v34 M200 334 v34 M60 120 l30 17 M340 120 l-30 17 M60 280 l30-17 M340 280 l-30-17" />
            <path d="M118 200 h-46 m0 0 v-28 M282 200 h46 m0 0 v28" />
          </g>
          {TRACE_NODES.map(([cx, cy, d], i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r="3.5"
              fill="var(--brand-teal)"
              className="motion-safe:animate-pulse"
              style={{ animationDelay: `${d}s`, animationDuration: "3.2s" }}
            />
          ))}
        </g>

        {/* ---- near layer: inner hexagon, the heartbeat, the cross ---- */}
        <g className="hero-depth-3">
          <polygon
            points={hexPoints(200, 200, 88)}
            stroke="url(#fx-stroke)"
            strokeWidth="1"
            strokeOpacity="0.3"
            fill="url(#fx-fill)"
            className="motion-safe:origin-center motion-safe:animate-[spin_58s_linear_infinite]"
          />

          {/* The vital-sign trace. */}
          <path
            d={ECG_PATH}
            stroke="url(#fx-stroke)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* …and a bright pulse travelling along it, like a monitor sweep. A second
              copy on top so the trace underneath never dims. pathLength="100" makes
              the dash pattern a percentage of the trace (see `ecg-sweep` in
              globals.css), so it holds however the waveform is redrawn. */}
          <path
            d={ECG_PATH}
            pathLength="100"
            strokeDasharray="12 88"
            stroke="var(--brand-teal)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            // A teal halo needs a dark surface to read against; on white it just
            // smears, so the glow is small in light mode and opens up in dark.
            className="motion-safe:animate-ecg-sweep [filter:drop-shadow(0_0_2px_var(--brand-teal))] motion-reduce:hidden dark:[filter:drop-shadow(0_0_6px_var(--brand-teal))]"
          />

          <g transform="translate(200 128)" fill="var(--brand-teal)" fillOpacity="0.9">
            <rect x="-4" y="-13" width="8" height="26" rx="2.5" />
            <rect x="-13" y="-4" width="26" height="8" rx="2.5" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/** The waveform, shared by the static trace and the pulse that sweeps along it. */
const ECG_PATH = "M104 200 h34 l10-22 12 46 14-62 13 74 11-36 h88";

/** Radius the constellation nodes sit on. */
const RING_RADIUS = 148;

/** Node positions around the ring, in degrees. Uneven on purpose — evenly spaced
 *  reads as a clock face, which is the one thing this should not look like. */
const RING_NODES = [8, 47, 74, 119, 156, 187, 223, 262, 291, 318, 341];

/** Which ring nodes are wired to each other, as pairs of angles from RING_NODES. */
const CHORDS: [number, number][] = [
  [8, 119],
  [47, 187],
  [74, 262],
  [119, 291],
  [156, 341],
  [223, 318],
];

function ringPoint(angleDeg: number) {
  const a = (Math.PI / 180) * angleDeg;
  return { x: 200 + RING_RADIUS * Math.cos(a), y: 200 + RING_RADIUS * Math.sin(a) };
}

/** Flat-top hexagon vertices, as an SVG `points` string. */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

/** [cx, cy, animation-delay] — the nodes that terminate the circuit traces. */
const TRACE_NODES: [number, number, number][] = [
  [200, 32, 0],
  [200, 368, 0.9],
  [90, 137, 0.3],
  [310, 137, 1.2],
  [90, 263, 0.6],
  [310, 263, 1.5],
  [72, 172, 0.4],
  [328, 228, 1.1],
];
