"use client";

import { useState } from "react";
import type { ClinicAnalytics } from "@/core/admin/clinic-analytics";
import { summariseWindow, type RatingWindow } from "@/core/admin/payment-behaviour";
import {
  GRADE_META,
  PAYER_CATEGORIES,
  PENDING_META,
  gradeFor,
  ratingColour,
  riskFor,
  statusColour,
  statusLabel,
} from "@/core/admin/payer-categories";
import { cn } from "@/core/lib/utils";
import { DonutChart } from "@/core/ui/charts/donut-chart";
import { RadialGauge } from "@/core/ui/charts/radial-gauge";
import { StatCard } from "@/core/ui/charts/stat-card";
import { TrendChart } from "@/core/ui/charts/trend-chart";
import { ChartTooltip, PAD, TooltipRow, useChartWidth, usePointerIndex } from "@/core/ui/charts/chart-kit";

/**
 * The clinic scorecard — presentation only, so the dialog owns loading and this owns
 * nothing but layout. Printable: the dialog's print CSS keeps this and drops the rest
 * of the page.
 *
 * TWO HALVES, deliberately together. "Pays us" and "their business" answer the same
 * question from opposite ends: a clinic paying late while its bookings climb is a
 * billing conversation, and one paying late while its diary empties is a churn
 * conversation. Split across two screens, nobody holds both numbers at once.
 *
 * The charts come from `core/ui/charts` — still hand-drawn SVG, since a charting
 * library would be a major dependency (CLAUDE.md §2) for shapes that are a few lines
 * of trigonometry each, and it would fight the print stylesheet. What changed is that
 * they are no longer drawn HERE: the ring, the gauge and the trend are the same
 * components the rest of the app uses, so a hover and a colour mean the same thing on
 * this card as on the P&L.
 *
 * ONE chart stays local — `RatingLine`. Its x axis is a set of windows of different
 * lengths rather than time, and its judgement bands carry meaning no generic chart
 * has, so it is built ON the shared kit rather than replaced by something from it.
 */

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const day = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—";
/** "Aug 2025" — the billing month, without the day that is always the 1st. */
const shortMonth = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-PK", { month: "short", year: "numeric" }) : "—";
const monthLabel = (d: Date) =>
  new Date(d).toLocaleDateString("en-PK", { month: "long", year: "numeric" });

const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "text-success-text",
  warn: "text-warning-text",
  bad: "text-destructive",
};
const BAND_BG: Record<"good" | "warn" | "bad", string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
};

/** Five stars, filled to the rating. Half-steps rounded to the nearest whole star. */
function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className="size-4" aria-hidden>
          <path
            d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.65l5.9-.85z"
            fill={i <= filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

/**
 * Rating across widening windows, All Time on the left.
 *
 * A LINE, not bars: the question is whether the relationship is trending, and a line
 * makes a slope visible at a glance where a bar chart makes you compare heights. Each
 * point is coloured by its own band, so a run that crosses from green into amber shows
 * the crossing rather than merely the shape.
 *
 * STRAIGHT segments, unlike every other chart in the app. The x axis here is not time
 * — it is a set of windows of different LENGTHS — so there is no in-between for a
 * curve to describe, and smoothing one in would draw ratings for periods nobody
 * measured. Gaps stay gaps for the same reason: an unrated window gets a dash, not a
 * line through it.
 *
 * Rebuilt on the chart kit (measured width, the shared tooltip, theme tokens). It was
 * a fixed 720x190 viewBox stretched to the card, which distorted every dot into an
 * ellipse and stroked the bands in hardcoded hex that ignored the dark theme.
 */
function RatingLine({ windows }: { windows: RatingWindow[] }) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const H = 200;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  // Inset the ends so the first and last dots — and their value labels — sit inside
  // the plot rather than half over its edge.
  const inset = Math.min(46, plotW / 4);
  const x = (i: number) =>
    windows.length <= 1
      ? PAD.left + plotW / 2
      : PAD.left + inset + (i / (windows.length - 1)) * (plotW - inset * 2);
  const y = (v: number) => PAD.top + plotH - (v / 5) * plotH;

  const { active, onMove, clear } = usePointerIndex(windows.length, x);

  if (windows.length === 0) return null;

  const pts = windows.map((w, i) => ({
    ...w,
    cx: x(i),
    cy: w.rating === null ? null : y(w.rating),
  }));

  // One polyline per unbroken run of rated points, so a gap is a gap rather than a
  // straight line implying values that were never measured.
  const runs: { cx: number; cy: number }[][] = [];
  let run: { cx: number; cy: number }[] = [];
  for (const p of pts) {
    if (p.cy === null) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push({ cx: p.cx, cy: p.cy });
    }
  }
  if (run.length > 1) runs.push(run);

  // The three judgement bands behind the line, so a point's height means something
  // without reading the axis. Tokens, not hex: these have to survive the dark theme.
  const bands = [
    { from: 3.5, to: 5, fill: "var(--color-success)", label: "GOOD" },
    { from: 1.5, to: 3.5, fill: "var(--color-warning)", label: "POOR" },
    { from: 0, to: 1.5, fill: "var(--color-destructive)", label: "CRITICAL" },
  ];

  const shown = active != null ? pts[active] : null;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Rating comparison"
          onPointerMove={onMove}
          onPointerLeave={clear}
          className="select-none"
        >
          {bands.map((b) => (
            <g key={b.label}>
              <rect
                x={PAD.left}
                y={y(b.to)}
                width={plotW}
                height={y(b.from) - y(b.to)}
                fill={b.fill}
                opacity={0.08}
              />
              <text
                x={PAD.left + 6}
                y={(y(b.from) + y(b.to)) / 2 + 3}
                className="fill-muted-foreground text-[8px] tracking-wider"
                opacity={0.7}
              >
                {b.label}
              </text>
            </g>
          ))}

          {[0, 1, 2, 3, 4, 5].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border/60"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(v) + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}

          {runs.map((r, i) => (
            <polyline
              key={i}
              points={r.map((p) => `${p.cx},${p.cy}`).join(" ")}
              fill="none"
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.8}
            />
          ))}

          {pts.map((p, i) => (
            <g key={p.label} opacity={active == null || active === i ? 1 : 0.5}>
              {p.cy === null ? (
                // No marker and no height: an ungraded window has no position on a
                // 0-5 axis, and putting one anywhere would be inventing a reading.
                <text
                  x={p.cx}
                  y={PAD.top + plotH / 2}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  —
                </text>
              ) : (
                <>
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={active === i ? 7 : 5.5}
                    fill={ratingColour(p.rating)}
                    className="stroke-card transition-all"
                    strokeWidth={2}
                  />
                  <text
                    x={p.cx}
                    y={p.cy - 13}
                    textAnchor="middle"
                    className="fill-foreground text-[11px] font-semibold tabular-nums"
                  >
                    {p.rating?.toFixed(1)}
                  </text>
                </>
              )}
              <text
                x={p.cx}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      )}

      {shown ? (
        <ChartTooltip x={shown.cx} width={width} title={shown.label}>
          <TooltipRow
            label="Rating"
            value={shown.rating === null ? "Not rated" : `${shown.rating.toFixed(1)} / 5`}
            color={shown.rating === null ? undefined : ratingColour(shown.rating)}
          />
          {/* A window is a LENGTH, not a date range — "last 6 months" — and the only
              other fact carried per window is how many months it spans. */}
          <TooltipRow
            label="Window"
            value={shown.months === null ? "All time" : `${shown.months} months`}
            muted
          />
        </ChartTooltip>
      ) : null}
    </div>
  );
}

function KpiCell({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold">{children}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}


export function ClinicAnalyticsCard({
  data,
  onPeriodChange,
  refreshing,
}: {
  data: ClinicAnalytics;
  /** Asks the server for the business half over the newly selected window. */
  onPeriodChange?: (months: number | null) => void;
  refreshing?: boolean;
}) {
  const { clinic, balance, behaviour, trend, windows, business, range } = data;
  const grade = gradeFor(behaviour.rating);
  const risk = riskFor(behaviour.current, behaviour.unpaidMonths);
  const total = behaviour.months.length;

  const trendWord =
    trend.direction === "improving"
      ? "Improving"
      : trend.direction === "declining"
        ? "Declining"
        : trend.direction === "stable"
          ? "Stable"
          : "Not enough history";
  const trendTone: "good" | "warn" | "bad" | undefined =
    trend.direction === "improving" ? "good" : trend.direction === "declining" ? "bad" : undefined;

  // A rating built from one or two months is noise wearing a decimal point. Say so
  // rather than print a confident number that would send someone to chase a clinic
  // over a single late payment.
  const thin = total > 0 && total < 3;

  // The period buttons, narrowest first — "how far back am I looking" reads naturally
  // upward. Same ladder the comparison chart uses, so the two cannot offer different
  // periods; `null` is all time.
  const periods = [...windows].reverse();
  const [selected, setSelected] = useState<number | null>(() => periods[0]?.months ?? null);
  const scoped = selected === null ? behaviour.months : behaviour.months.slice(-selected);
  const window = summariseWindow(scoped);

  // `behaviour.months` is OLDEST first, which is already what a left-to-right trend
  // wants — it is the TABLE below that reverses, to put the newest row on top. (This
  // read the other way round at first and drew the year backwards, from July 2026 on
  // the left to August 2025 on the right.)
  //
  // Only months that were actually SETTLED: an unpaid month has no days-late figure,
  // and plotting it as zero would read as "paid on the due date" — the opposite of
  // the truth. They are counted in the caption instead.
  const settledMonths = scoped.filter((m) => m.daysLate !== null);
  const unsettled = scoped.length - settledMonths.length;
  const lateTrend = settledMonths.map((m) => ({
    label: shortMonth(m.period),
    value: m.daysLate as number,
  }));
  const windowGrade = gradeFor(window.rating);
  const periodLabel = selected === null ? "all time" : `last ${selected} months`;
  const first = behaviour.months[0]?.dueAt ?? null;
  const last = behaviour.months[total - 1]?.dueAt ?? null;

  return (
    <div className="analytics-sheet space-y-5 text-sm">
      {/* ── Grade band ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-4 rounded-xl p-4 text-white",
          grade ? BAND_BG[GRADE_META[grade].tone] : "bg-muted-foreground",
        )}
      >
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold">{clinic.name}</h2>
          <p className="text-xs opacity-90">
            {[clinic.city, clinic.ownerName].filter(Boolean).join(" · ") || "No location recorded"}
            {clinic.monthlyPrice > 0 ? ` · ${rs(clinic.monthlyPrice)}/month` : " · No subscription price"}
          </p>
          {behaviour.rating !== null ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <Stars rating={behaviour.rating} />
                <span className="text-sm font-semibold">{behaviour.rating.toFixed(1)}</span>
                <span className="text-xs opacity-90">
                  / 5 · {total} month{total === 1 ? "" : "s"} billed (all time)
                </span>
              </div>
              <span className="mt-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
                {trendWord}
              </span>
              {trend.direction !== "unknown" && trend.recent !== null && trend.lifetime !== null ? (
                <p className="mt-1 text-[11px] opacity-90">
                  Last 3 months vs all time — the trend is this comparison: {trend.recent.toFixed(1)}{" "}
                  against {trend.lifetime.toFixed(1)}.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {grade ? (
          <div className="rounded-lg border-2 border-white/60 px-4 py-2 font-heading text-lg font-bold tracking-wide">
            {GRADE_META[grade].label}
          </div>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="rounded-lg border p-3 text-muted-foreground">
          {clinic.monthlyPrice > 0
            ? "No month has been billed yet, so there is nothing to rate."
            : "This clinic has no subscription price, so it is never billed."}
        </p>
      ) : (
        <>
          {thin ? (
            <p className="rounded-lg border border-warning/35 bg-warning/10 p-2 text-xs">
              Only {total} month{total === 1 ? "" : "s"} of history — treat the rating as provisional.
            </p>
          ) : null}

          {/* ── KPI strip ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-stretch divide-x divide-border rounded-lg border">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
              <RadialGauge
                value={behaviour.onTimeRate ?? 0}
                color={ratingColour(behaviour.rating)}
                label="On-time rate"
                size={60}
              />
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                On-time
                <br />
                rate
              </div>
            </div>
            <KpiCell label="Current status">
              {behaviour.current ? statusLabel(behaviour.current) : "—"}
            </KpiCell>
            <KpiCell label="Risk level">
              <span className={TONE[risk.tone]}>{risk.label}</span>
            </KpiCell>
            <KpiCell
              label="Owed to us"
              hint={
                balance.owed > 0
                  ? `${balance.daysOverdue} day${balance.daysOverdue === 1 ? "" : "s"} overdue`
                  : balance.credit > 0
                    ? "paid ahead"
                    : `paid through ${day(balance.paidThrough)}`
              }
            >
              {balance.owed > 0 ? (
                <span className={balance.billingStatus === "overdue" ? TONE.bad : TONE.warn}>
                  {rs(balance.owed)}
                </span>
              ) : (
                <span className={TONE.good}>
                  {balance.credit > 0 ? rs(balance.credit) : "Nothing owed"}
                </span>
              )}
            </KpiCell>
            <KpiCell
              label="History"
              hint={`${total} month${total === 1 ? "" : "s"}`}
            >
              <span className="text-xs font-normal">
                {shortMonth(first)} → {shortMonth(last)}
              </span>
            </KpiCell>
          </div>

          {/* ── Period selector ───────────────────────────────────────────── */}
          {/* Only periods the history can fill are offered — a "24m" button on a
              14-month clinic would return the same rows as All time and read as a
              broken filter. */}
          <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Period
            </span>
            {periods.map((w) => (
              <button
                key={w.label}
                type="button"
                aria-pressed={selected === w.months}
                onClick={() => {
                  setSelected(w.months);
                  onPeriodChange?.(w.months);
                }}
                className={cn(
                  "rounded-md border px-3 py-1 text-xs transition-colors",
                  selected === w.months
                    ? "border-primary bg-primary/10 font-medium"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {w.months === null ? "All time" : `${w.months} months`}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-muted-foreground">
              Applies to everything below.
            </span>
          </div>

          {/* ── Category share ────────────────────────────────────────────── */}
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Category share — {periodLabel}
              </span>
              <span className="text-xs text-muted-foreground">
                {window.total} month{window.total === 1 ? "" : "s"} graded
                {window.pending > 0 ? ` · ${window.pending} not yet due` : ""}
              </span>
            </div>
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold">
                {window.rating === null ? "—" : window.rating.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">/ 5</span>
              {window.rating !== null ? <Stars rating={window.rating} /> : null}
              {windowGrade ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium text-white",
                    BAND_BG[GRADE_META[windowGrade].tone],
                  )}
                >
                  {GRADE_META[windowGrade].label}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                · {window.total} month{window.total === 1 ? "" : "s"} · {pct(window.onTimeRate)} on time
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              {/* The ring only. The list beside it names EVERY band, including the
                  ones this clinic has no months in — that a clinic has zero
                  Defaulter months is the reassuring half of the picture, and a
                  legend built from the slices cannot say it. */}
              <DonutChart
                ariaLabel="Payment category share"
                legend={false}
                size={112}
                centerLabel={window.total === 1 ? "month" : "months"}
                formatValue={() => String(window.total)}
                slices={PAYER_CATEGORIES.map((c) => ({
                  label: c.label,
                  value: window.counts[c.code] ?? 0,
                  color: c.colour,
                }))}
              />
              <ul className="min-w-56 flex-1 space-y-1.5">
                {PAYER_CATEGORIES.map((c) => {
                  const n = window.counts[c.code] ?? 0;
                  const share = window.total ? n / window.total : 0;
                  return (
                    <li key={c.code} className="flex items-center gap-3">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.colour }}
                        aria-hidden
                      />
                      <span className={cn("w-32 shrink-0 text-xs", n === 0 && "text-muted-foreground")}>
                        {c.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${share * 100}%`, backgroundColor: c.colour }}
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {n} · {Math.round(share * 100)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {[...PAYER_CATEGORIES.map((c) => `${c.label} = ${c.hint}`), `${PENDING_META.label} = ${PENDING_META.hint}`].join(" · ")}
            </p>
          </div>

          {/* ── Rating comparison ─────────────────────────────────────────── */}
          <div className="rounded-lg border p-4">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Rating comparison — all time
              </span>
              <span className={cn("text-xs", trendTone && TONE[trendTone])}>{trendWord}</span>
            </div>
            <RatingLine windows={windows} />
          </div>

          {/* ── How late, month by month ──────────────────────────────────── */}
          {lateTrend.length > 1 ? (
            <div className="rounded-lg border p-4">
              <div className="mb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Days late — {periodLabel}
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                How long after the due date each month was settled. Below the line is early.
                {unsettled > 0
                  ? ` ${unsettled} month${unsettled === 1 ? " is" : "s are"} still unpaid and cannot be plotted.`
                  : ""}
              </p>
              <TrendChart
                ariaLabel="Days late by month"
                points={lateTrend}
                valueLabel="Days late"
                mode="line"
                color="var(--color-chart-4)"
                height={180}
                formatValue={(v) =>
                  v === 0
                    ? "On the due date"
                    : v > 0
                      ? `${v} day${v === 1 ? "" : "s"} late`
                      : `${Math.abs(v)} day${Math.abs(v) === 1 ? "" : "s"} early`
                }
              />
            </div>
          ) : null}

          {/* ── Every billed month ───────────────────────────────────────── */}
          {scoped.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Payment history — {periodLabel}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {scoped.length} month{scoped.length === 1 ? "" : "s"}, newest first
                </span>
              </div>
              <div className="analytics-scroll max-h-72 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Month</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium">Settled</th>
                    <th className="px-3 py-2 font-medium">Days late</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scoped].reverse().map((m) => (
                      <tr key={m.dueAt.toISOString()} className="border-t">
                        <td className="px-3 py-2">{monthLabel(m.period)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{day(m.dueAt)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {m.settledAt ? day(m.settledAt) : "unpaid"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {m.daysLate === null ? "—" : `${m.daysLate}`}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: statusColour(m.category) }}
                              aria-hidden
                            />
                            {statusLabel(m.category)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{rs(m.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ── B. Their business ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Clinic activity · {range.label}
          {refreshing ? <span className="ml-2 normal-case tracking-normal">updating…</span> : null}
        </h3>
        <div
          className={cn(
            "grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4",
            refreshing && "opacity-50",
          )}
        >
          <StatCard
            label="Patients"
            value={business.patientsTotal.toLocaleString("en-PK")}
            hint={`all time · ${business.patientsNew} new in period`}
          />
          <StatCard
            label="Appointments"
            value={business.appointments.toLocaleString("en-PK")}
            hint={`${business.completed} completed · ${business.cancelled} cancelled`}
          />
          <StatCard
            label="No-show rate"
            value={pct(business.noShowRate)}
            hint={`${business.noShows} of ${business.completed + business.noShows} expected`}
            tone={business.noShowRate !== null && business.noShowRate > 0.2 ? "bad" : "default"}
          />
          <StatCard
            label="Visits recorded"
            value={business.visits.toLocaleString("en-PK")}
            hint={`${business.scribeRuns} used the scribe`}
          />
          <StatCard label="Collected" value={rs(business.collected)} hint="from their patients, this period" />
          <StatCard
            label="Their receivable"
            value={rs(business.outstanding)}
            hint="all time · what patients still owe them"
          />
          <StatCard
            label="Staff"
            value={business.staffActive.toLocaleString("en-PK")}
            hint={`now · ${business.doctors} doctor${business.doctors === 1 ? "" : "s"}`}
          />
          <StatCard label="WhatsApp" value={`${business.whatsappOut} out`} hint={`${business.whatsappIn} in`} />
        </div>
        <p className="text-xs text-muted-foreground">
          Last appointment booked {business.lastActivityAt ? day(business.lastActivityAt) : "— never"}.
          {clinic.activatedAt ? ` Subscription started ${day(clinic.activatedAt)}.` : ""}
        </p>
      </section>
    </div>
  );
}
