"use client";

import { useState } from "react";
import type { ClinicAnalytics } from "@/core/admin/clinic-analytics";
import { summariseWindow, type RatingWindow } from "@/core/admin/payment-behaviour";
import {
  GRADE_META,
  PAYER_CATEGORIES,
  type PayerCategory,
  gradeFor,
  payerLabel,
  ratingColour,
  riskFor,
} from "@/core/admin/payer-categories";
import { cn } from "@/core/lib/utils";

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
 * Every chart is hand-drawn SVG. A charting library would be a major dependency
 * (CLAUDE.md §2) for two shapes — a donut and a polyline — that are a few lines of
 * trigonometry each, and it would fight the print stylesheet.
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
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
};
const BAND_BG: Record<"good" | "warn" | "bad", string> = {
  good: "bg-emerald-600",
  warn: "bg-amber-500",
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

/** A ring showing one percentage — the on-time rate. */
function Donut({ value, colour, label }: { value: number; colour: string; label: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0" role="img" aria-label={label}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-muted" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text x="28" y="32" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

/** Category share as a ring, one arc per band, in severity order. */
function ShareDonut({
  counts,
  total,
  rating,
}: {
  counts: Record<PayerCategory, number>;
  total: number;
  rating: number | null;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const arcs = PAYER_CATEGORIES.reduce<{ code: string; colour: string; len: number; offset: number }[]>(
    (acc, cat) => {
      const n = counts[cat.code] ?? 0;
      if (n === 0) return acc;
      const prev = acc[acc.length - 1];
      const offset = prev ? prev.offset + prev.len : 0;
      acc.push({ code: cat.code, colour: cat.colour, len: (n / total) * c, offset });
      return acc;
    },
    [],
  );
  return (
    <svg viewBox="0 0 96 96" className="size-28 shrink-0" role="img" aria-label="Category share">
      {arcs.map((a) => (
        <circle
          key={a.code}
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={a.colour}
          strokeWidth="14"
          strokeDasharray={`${a.len} ${c - a.len}`}
          strokeDashoffset={-a.offset}
          transform="rotate(-90 48 48)"
        />
      ))}
      <text x="48" y="46" textAnchor="middle" className="fill-foreground text-[15px] font-bold">
        {rating === null ? "—" : rating.toFixed(1)}
      </text>
      <text x="48" y="58" textAnchor="middle" className="fill-muted-foreground text-[8px]">
        {total} month{total === 1 ? "" : "s"}
      </text>
    </svg>
  );
}

/**
 * Rating across widening windows, All Time on the left.
 *
 * A LINE, not bars: the question is whether the relationship is trending, and a line
 * makes a slope visible at a glance where a bar chart makes you compare heights. Each
 * point is coloured by its own band, so a run that crosses from green into amber shows
 * the crossing rather than merely the shape.
 */
function RatingLine({ windows }: { windows: RatingWindow[] }) {
  if (windows.length === 0) return null;
  const W = 720;
  const H = 190;
  const padL = 44;
  const padR = 44;
  const padT = 22;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const inset = 46;
  const x = (i: number) =>
    windows.length === 1
      ? padL + plotW / 2
      : padL + inset + (i / (windows.length - 1)) * (plotW - inset * 2);
  const y = (v: number) => padT + plotH - (v / 5) * plotH;

  const pts = windows.map((w, i) => ({ ...w, cx: x(i), cy: y(w.rating ?? 0) }));
  const line = pts.map((p) => `${p.cx},${p.cy}`).join(" ");

  // The three judgement bands behind the line, so a point's height means something
  // without reading the axis.
  const bands = [
    { from: 3.5, to: 5, fill: "#15803d", label: "GOOD" },
    { from: 1.5, to: 3.5, fill: "#eab308", label: "POOR" },
    { from: 0, to: 1.5, fill: "#ef4444", label: "CRITICAL" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Rating comparison">
      {bands.map((b) => (
        <g key={b.label}>
          <rect x={padL} y={y(b.to)} width={plotW} height={y(b.from) - y(b.to)} fill={b.fill} opacity="0.07" />
          <text
            x={padL + 6}
            y={(y(b.from) + y(b.to)) / 2 + 3}
            className="fill-muted-foreground text-[8px] tracking-wider"
            opacity="0.65"
          >
            {b.label}
          </text>
        </g>
      ))}
      {[0, 1, 2, 3, 4, 5].map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="currentColor" strokeWidth="0.5" className="text-border" />
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {v}
          </text>
        </g>
      ))}
      <polyline points={line} fill="none" stroke="#15803d" strokeWidth="2" strokeLinejoin="round" opacity="0.7" />
      {pts.map((p) => (
        <g key={p.label}>
          <circle cx={p.cx} cy={p.cy} r="6" fill={ratingColour(p.rating)} stroke="#fff" strokeWidth="2" />
          <text x={p.cx} y={p.cy - 12} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
            {p.rating === null ? "—" : p.rating.toFixed(1)}
          </text>
          <text x={p.cx} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
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

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", tone && TONE[tone])}>{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
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
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              Only {total} month{total === 1 ? "" : "s"} of history — treat the rating as provisional.
            </p>
          ) : null}

          {/* ── KPI strip ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-stretch divide-x divide-border rounded-lg border">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
              <Donut
                value={behaviour.onTimeRate ?? 0}
                colour={ratingColour(behaviour.rating)}
                label="On-time rate"
              />
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                On-time
                <br />
                rate
              </div>
            </div>
            <KpiCell label="Current status">
              {behaviour.current ? payerLabel(behaviour.current) : "—"}
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
                {window.total} month{window.total === 1 ? "" : "s"}
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
              <ShareDonut counts={window.counts} total={window.total} rating={window.rating} />
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
              {PAYER_CATEGORIES.map((c) => `${c.label} = ${c.hint}`).join(" · ")}
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
                              style={{
                                backgroundColor:
                                  PAYER_CATEGORIES.find((c) => c.code === m.category)?.colour,
                              }}
                              aria-hidden
                            />
                            {payerLabel(m.category)}
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
          <Kpi
            label="Patients"
            value={business.patientsTotal.toLocaleString("en-PK")}
            hint={`${business.patientsNew} new in period`}
          />
          <Kpi
            label="Appointments"
            value={business.appointments.toLocaleString("en-PK")}
            hint={`${business.completed} completed · ${business.cancelled} cancelled`}
          />
          <Kpi
            label="No-show rate"
            value={pct(business.noShowRate)}
            hint={`${business.noShows} of settled visits`}
            tone={business.noShowRate !== null && business.noShowRate > 0.2 ? "warn" : undefined}
          />
          <Kpi
            label="Visits recorded"
            value={business.visits.toLocaleString("en-PK")}
            hint={`${business.scribeRuns} used the scribe`}
          />
          <Kpi label="Collected" value={rs(business.collected)} hint="from their patients, this period" />
          <Kpi
            label="Their receivable"
            value={rs(business.outstanding)}
            hint="what patients still owe them"
          />
          <Kpi
            label="Staff"
            value={business.staffActive.toLocaleString("en-PK")}
            hint={`${business.doctors} doctor${business.doctors === 1 ? "" : "s"}`}
          />
          <Kpi label="WhatsApp" value={`${business.whatsappOut} out`} hint={`${business.whatsappIn} in`} />
        </div>
        <p className="text-xs text-muted-foreground">
          Last appointment booked {business.lastActivityAt ? day(business.lastActivityAt) : "— never"}.
          {clinic.activatedAt ? ` Subscription started ${day(clinic.activatedAt)}.` : ""}
        </p>
      </section>
    </div>
  );
}
