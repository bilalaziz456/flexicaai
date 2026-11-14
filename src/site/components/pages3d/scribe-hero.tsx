"use client";

import { AlertTriangle, Check, FileCheck2, Mic, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DICTATION } from "../mockups/scribe";
import { SAMPLE } from "../mockups/frame";
import { useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";

/**
 * AI Scribe hero — the product's real flow as one cinematic loop, in HTML, SVG and CSS.
 *
 * Replaced a Three.js prism (owner, 2026-11-15: not liked; then "too simple — make it
 * modern"). The scene: a voice orb listens while the dictation types itself out; the
 * transcript streams along a beam into a tilted glass note whose sections shimmer in,
 * each lighting up the words it came from; the one unclear word is flagged and the
 * doctor confirms it; only then does the "Approved" seal draw itself. That order IS
 * the product's promise (CLAUDE.md §8: every AI output is a draft until a clinician
 * approves it), so the animation argues the claim instead of decorating it.
 *
 * Continuous motion (orb bars, ring, shimmer, beam) is CSS (`sh-*` in site.css); the
 * component only moves through phases on a coarse ~12 fps clock. No WebGL, so it runs
 * on every screen. Server render and reduced motion show the END frame — the approved
 * note — which is also what a search engine or screenshot should see.
 */

const LOOP = 17000;
const END = 14000;
const T = {
  wordsFrom: 600,
  recordEnd: 5200,
  rowsFrom: 5600,
  rowGap: 800,
  chips: 9900,
  flagResolve: 10700,
  approve: 12100,
} as const;

const ROWS: { k: string; v: string; flag?: boolean }[] = [
  { k: "Chief complaint", v: "Sore throat and fever, 3 days" },
  { k: "Allergies", v: "Penicillin" },
  { k: "Examination", v: "38.4 °C · tonsils enlarged, exudate" },
  { k: "Diagnosis", v: "Acute tonsillitis" },
  { k: "Medicines", v: "Azithromycin 500 mg · OD × 3 days" },
  { k: "Needs review", v: "Second medicine unclear", flag: true },
];

/** The words in the dictation each section was drawn from, so they can light up. */
const SOURCES = [
  "Sore throat and fever for three days",
  "Allergic to penicillin",
  "temperature thirty-eight point four, tonsils enlarged",
  "Acute tonsillitis",
  "Azithromycin five hundred, once a day for three days",
  "[unclear]",
];

type Seg = { text: string; start: number; row: number | null };
const SEGMENTS: Seg[] = (() => {
  const marks = SOURCES.map((p, row) => ({ row, at: DICTATION.indexOf(p), len: p.length }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: Seg[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.at > pos) out.push({ text: DICTATION.slice(pos, m.at), start: pos, row: null });
    out.push({ text: DICTATION.slice(m.at, m.at + m.len), start: m.at, row: m.row });
    pos = m.at + m.len;
  }
  if (pos < DICTATION.length) out.push({ text: DICTATION.slice(pos), start: pos, row: null });
  return out;
})();

const STEPS = ["Record", "Transcribe", "Structure", "Approve"] as const;

// Radial bars around the orb: deterministic lengths and timings (no Math.random in render).
const BARS = Array.from({ length: 56 }, (_, i) => ({
  angle: Math.round((i / 56) * 3600) / 10,
  // Rounded: server and browser maths differ in the last digit, which breaks hydration.
  len: Math.round((10 + 24 * Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.6))) * 10) / 10,
  delay: (i % 9) * 0.09,
  dur: 0.6 + (i % 5) * 0.11,
}));

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(reducedQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function useLoopClock(active: boolean): number {
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => true);
  const [t, setT] = useState<number>(END);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!active || reduced) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (start.current === null) start.current = now;
      if (now - last > 80) {
        last = now;
        setT((now - start.current) % LOOP);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);
  return reduced ? END : t;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function ScribeHero() {
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(box, "100px");
  const t = useLoopClock(onScreen);

  const recording = t < T.recordEnd;
  const chars = Math.round(clamp01((t - T.wordsFrom) / (T.recordEnd - 200 - T.wordsFrom)) * DICTATION.length);
  const rowsShown = t < T.rowsFrom ? 0 : Math.min(ROWS.length, 1 + Math.floor((t - T.rowsFrom) / T.rowGap));
  const structuring = t >= T.recordEnd && rowsShown < ROWS.length;
  const flowing = t >= T.wordsFrom + 800 && rowsShown < ROWS.length;
  const chips = t >= T.chips;
  const flagResolved = t >= T.flagResolve;
  const approved = t >= T.approve;
  const step = approved ? 3 : t >= T.rowsFrom ? 2 : t >= T.wordsFrom ? 1 : 0;
  const progress = approved
    ? 1
    : t < T.recordEnd
      ? clamp01(t / T.recordEnd) / 3
      : t < T.flagResolve
        ? 1 / 3 + clamp01((t - T.rowsFrom) / (T.flagResolve - T.rowsFrom)) / 3
        : 2 / 3 + clamp01((t - T.flagResolve) / (T.approve - T.flagResolve)) / 3;
  const secs = Math.round(clamp01(t / T.recordEnd) * 108); // the clip is 01:48
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const fading = t > LOOP - 600;

  return (
    <div ref={box} className="grid gap-4">
      <div
        className={cx(
          "relative mx-auto grid w-full max-w-[660px] gap-6 transition-opacity duration-500 lg:min-h-[500px] lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:content-center lg:items-center lg:gap-x-11",
          fading ? "opacity-0" : "opacity-100",
        )}
      >
        {/* Ambient light */}
        <div aria-hidden className="pointer-events-none absolute -inset-10 overflow-hidden">
          <div className="sh-aurora absolute left-[4%] top-[8%] size-72 rounded-full bg-teal/20 blur-3xl" />
          <div className="sh-aurora absolute bottom-[6%] right-[6%] size-80 rounded-full bg-blue/20 blur-3xl [animation-delay:-7s]" />
        </div>

        <div className="relative grid gap-5">
        {/* Voice orb */}
        <div className="relative mx-auto size-[220px]">
          <div aria-hidden className={cx("absolute inset-8 rounded-full blur-2xl transition-colors duration-700", recording ? "bg-teal/35" : "bg-teal/15")} />
          <div aria-hidden className={cx("sh-ring absolute inset-[38px] transition-opacity duration-700", recording ? "opacity-100" : "opacity-30")} />
          <svg viewBox="0 0 220 220" className="absolute inset-0" aria-hidden>
            <defs>
              <linearGradient id="sh-bar-grad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#0fb4bb" />
                <stop offset="1" stopColor="#9ff3f5" />
              </linearGradient>
            </defs>
            {BARS.map((b, i) => (
              <g key={i} transform={`rotate(${b.angle} 110 110)`}>
                <rect
                  x={108.5}
                  y={Math.round((110 - 58 - b.len) * 10) / 10}
                  width={3}
                  height={b.len}
                  rx={1.5}
                  fill="url(#sh-bar-grad)"
                  className={cx("sh-bar", !recording && "sh-bar-idle")}
                  style={{ animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, opacity: recording ? 0.95 : 0.35 }}
                />
              </g>
            ))}
          </svg>
          <div className="absolute inset-[66px] grid place-items-center rounded-full border border-white/15 bg-gradient-to-b from-navy-700 to-navy-900 shadow-[0_0_40px_-8px_rgba(15,180,187,0.6),inset_0_1px_0_rgba(255,255,255,0.12)]">
            <span className={cx("grid size-12 place-items-center rounded-full transition-colors duration-500", recording ? "bg-gradient-to-br from-rose-400 to-rose-600" : "bg-gradient-to-br from-teal to-blue")}>
              {recording && <span aria-hidden className="absolute size-12 rounded-full bg-rose-500/50 motion-safe:animate-pulse-ring" />}
              {recording ? <Mic className="relative size-5 text-white" aria-hidden /> : <Check className="size-5 text-navy-900" aria-hidden />}
            </span>
          </div>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-navy-900/80 px-3 py-1 font-mono text-[11px] text-slate-300 backdrop-blur">
              <span className={cx("size-1.5 rounded-full", recording ? "bg-rose-400 motion-safe:animate-pulse" : "bg-teal-glow")} />
              {recording ? "REC" : "DONE"} · {clock}
            </span>
          </div>
        </div>

        {/* Live transcript */}
        <Glass className="relative p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Live transcript</p>
            <span className="text-[10px] text-slate-500">{SAMPLE.patient}</span>
          </div>
          <div className="mt-2 h-[132px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_28%)]">
            <p className="flex h-full flex-col justify-end text-[12px] leading-[1.35rem] text-slate-300">
              <span>
                {SEGMENTS.map((s) => {
                  const visible = Math.max(0, Math.min(s.text.length, chars - s.start));
                  if (visible === 0) return null;
                  const lit = s.row !== null && s.row < rowsShown;
                  const isFlag = s.row === ROWS.length - 1;
                  return (
                    <span
                      key={s.start}
                      className={cx(
                        "rounded-[4px] transition-colors duration-500",
                        lit && !isFlag && "bg-teal/20 text-teal-glow shadow-[0_0_0_2px_rgba(15,180,187,0.2)]",
                        isFlag && (flagResolved ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/20 text-amber-200"),
                      )}
                    >
                      {s.text.slice(0, visible)}
                    </span>
                  );
                })}
                {recording && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-teal-glow motion-safe:animate-pulse" />}
              </span>
            </p>
          </div>
        </Glass>

        </div>

        {/* The note */}
        <div className="relative lg:[perspective:1400px]">
          {/* The beam: what was said streams into the note */}
          <svg aria-hidden viewBox="0 0 48 120" preserveAspectRatio="none" className="pointer-events-none absolute right-full top-1/2 hidden h-[120px] w-12 -translate-y-1/2 lg:block">
            <defs>
              <linearGradient id="sh-beam" x1="0" x2="1">
                <stop offset="0" stopColor="#0fb4bb" stopOpacity="0.1" />
                <stop offset="0.5" stopColor="#5fe0e4" stopOpacity="0.9" />
                <stop offset="1" stopColor="#069fc5" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            <path d="M 0 90 C 26 90, 22 40, 48 40" fill="none" stroke="url(#sh-beam)" strokeWidth="1.5" className={cx("transition-opacity duration-500", flowing ? "opacity-100" : "opacity-25")} />
            <path d="M 0 90 C 26 90, 22 40, 48 40" fill="none" stroke="#5fe0e4" strokeWidth="2" className={cx("sh-dash transition-opacity duration-500", flowing ? "opacity-70" : "opacity-0")} />
            {flowing &&
              [0, 0.4, 0.8].map((b) => (
                <circle key={b} r="2.4" fill="#9ff3f5" style={{ filter: "drop-shadow(0 0 4px #5fe0e4)" }}>
                  <animateMotion dur="1.2s" repeatCount="indefinite" begin={`${b}s`} path="M 0 90 C 26 90, 22 40, 48 40" />
                </circle>
              ))}
          </svg>
          <div className="transition-transform duration-700 [transform-origin:left_center] lg:[transform:rotateY(-9deg)_rotateX(3deg)] lg:hover:[transform:none]">
            <Glass className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal/40 to-blue/40 text-[11px] font-semibold text-white ring-1 ring-white/15">
                  AK
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-white">{SAMPLE.patient}</p>
                  <p className="font-mono text-[10px] text-slate-500">{SAMPLE.mrn} · Clinical note</p>
                </div>
                <span className="relative inline-grid">
                  <Badge show={!approved} tone="amber" icon={<PenLine className="size-3" aria-hidden />}>
                    Draft
                  </Badge>
                  <Badge show={approved} tone="emerald" icon={<ShieldCheck className="size-3" aria-hidden />}>
                    Approved
                  </Badge>
                </span>
              </div>

              <dl className="px-4 py-1.5">
                {ROWS.map((r, i) => {
                  const shown = i < rowsShown;
                  const next = structuring && i === rowsShown;
                  const flagged = r.flag && !flagResolved;
                  return (
                    <div key={r.k} className="relative py-[7px]">
                      {!shown && (
                        <div className="grid grid-cols-[5.6rem_1fr] items-center gap-3">
                          <span className={cx("h-2 w-16 rounded-full", next ? "sh-shimmer" : "bg-white/[0.05]")} />
                          <span className={cx("h-2 rounded-full", next ? "sh-shimmer" : "bg-white/[0.05]")} style={{ width: `${60 + ((i * 17) % 35)}%` }} />
                        </div>
                      )}
                      {shown && (
                        <div
                          className={cx(
                            "grid grid-cols-[5.6rem_1fr] gap-3 text-[11.5px] motion-safe:animate-[sh-rise_0.5s_var(--ease-out-expo)]",
                            r.flag && "-mx-2 rounded-lg px-2 py-1 transition-colors duration-500",
                            r.flag && (flagged ? "bg-amber-400/10 ring-1 ring-amber-300/25" : "bg-emerald-400/10 ring-1 ring-emerald-300/20"),
                          )}
                        >
                          <dt className={cx("font-medium", r.flag ? (flagged ? "text-amber-200" : "text-emerald-200") : "text-slate-400")}>
                            {r.flag && flagged && <AlertTriangle className="mr-1 inline size-3 -translate-y-px" aria-hidden />}
                            {r.flag && !flagged ? "Reviewed" : r.k}
                          </dt>
                          <dd className={cx(r.flag ? (flagged ? "text-amber-100" : "text-emerald-100") : "text-slate-100")}>
                            {r.flag && !flagged ? "Confirmed: no second medicine" : r.v}
                          </dd>
                        </div>
                      )}
                    </div>
                  );
                })}
              </dl>

              <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                <p className="text-[10.5px] leading-snug text-slate-400">
                  {approved ? (
                    <>
                      Signed by <span className="text-slate-200">{SAMPLE.doctor}</span>
                    </>
                  ) : (
                    "A draft until the doctor approves it"
                  )}
                </p>
                <span
                  aria-hidden
                  className={cx(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all duration-500",
                    approved
                      ? "bg-emerald-400 text-navy-900 shadow-[0_0_24px_-4px_rgba(52,211,153,0.8)]"
                      : rowsShown === ROWS.length && flagResolved
                        ? "bg-teal text-navy-900 shadow-[0_0_0_4px_rgba(15,180,187,0.25)]"
                        : "bg-white/[0.06] text-slate-500",
                  )}
                >
                  <Check className="size-3.5" /> {approved ? "Approved" : "Approve"}
                </span>
              </div>

              {/* The seal */}
              <div
                aria-hidden
                className={cx(
                  "pointer-events-none absolute bottom-16 right-4 transition-all duration-700 [transition-timing-function:var(--ease-out-expo)]",
                  approved ? "rotate-[-12deg] scale-100 opacity-100" : "rotate-[8deg] scale-150 opacity-0",
                )}
              >
                <div className="grid size-[76px] place-items-center rounded-full border-2 border-emerald-300/70 bg-emerald-400/10 shadow-[0_0_40px_-6px_rgba(52,211,153,0.6)] backdrop-blur-sm">
                  <svg viewBox="0 0 40 40" className="size-9">
                    <path d="M11 21 l6 6 l12 -14" fill="none" stroke="#6ee7b7" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className={cx("sh-check", approved && "sh-check-on")} />
                  </svg>
                  <span className="-mt-3 font-mono text-[8.5px] font-semibold tracking-[0.2em] text-emerald-200">SIGNED</span>
                </div>
              </div>
            </Glass>
          </div>
          {/* Checks the scribe ran */}
          <Chip show={chips} className="-right-3 -top-4" icon={<FileCheck2 className="size-3.5 text-teal-glow" aria-hidden />}>
            Formulary matched
          </Chip>
          <Chip show={chips} className="-bottom-5 left-4 [animation-delay:-3s]" icon={<ShieldCheck className="size-3.5 text-teal-glow" aria-hidden />}>
            Penicillin allergy · avoided
          </Chip>

        </div>

        {/* Where we are in the flow */}
        <div className="relative lg:col-span-2">
          <div className="relative mx-2 h-[2px] rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-teal to-teal-glow shadow-[0_0_12px_rgba(95,224,228,0.7)] transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cx(
                  "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors duration-500",
                  i <= step ? "border-teal-glow bg-teal-glow shadow-[0_0_10px_rgba(95,224,228,0.9)]" : "border-white/25 bg-navy-900",
                )}
                style={{ left: `${(i / 3) * 100}%` }}
              />
            ))}
          </div>
          <ol className="mt-3 grid grid-cols-4 text-[10.5px] font-medium" aria-label="How the scribe works">
            {STEPS.map((s, i) => (
              <li key={s} className={cx("transition-colors duration-500", i === 0 ? "text-left" : i === 3 ? "text-right" : "text-center", i === step ? "text-white" : i < step ? "text-teal-glow/80" : "text-slate-500")}>
                {i === step && i === 2 && !approved ? (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="size-3" aria-hidden /> {s}
                  </span>
                ) : (
                  s
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="text-center lg:text-right">
        <SampleTag dark>Illustration · sample dictation</SampleTag>
      </p>
    </div>
  );
}

function Glass({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.03] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Badge({ show, tone, icon, children }: { show: boolean; tone: "amber" | "emerald"; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cx(
        "col-start-1 row-start-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 transition-all duration-500",
        tone === "amber" ? "bg-amber-400/15 text-amber-200 ring-amber-300/30" : "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
        show ? "scale-100 opacity-100" : "scale-90 opacity-0",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Chip({ show, className, icon, children }: { show: boolean; className?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cx(
        "absolute z-10 hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-teal/30 bg-navy-900/85 px-3 py-1.5 text-[11px] font-medium text-slate-100 shadow-[0_10px_30px_-10px_rgba(15,180,187,0.5)] backdrop-blur transition-all duration-700 lg:inline-flex motion-safe:animate-float",
        show ? "opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
