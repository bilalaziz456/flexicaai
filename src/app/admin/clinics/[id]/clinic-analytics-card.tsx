"use client";

import type { ClinicAnalytics } from "@/core/admin/clinic-analytics";
import {
  GRADE_META,
  PAYER_CATEGORIES,
  gradeFor,
  payerLabel,
  riskFor,
} from "@/core/admin/payer-categories";
import { cn } from "@/core/lib/utils";

/**
 * The clinic scorecard — presentation only, so the dialog owns loading and the card
 * owns nothing but layout. Printable: the dialog's print CSS keeps this and drops the
 * rest of the page, which is how the reference report was produced.
 *
 * TWO HALVES, deliberately together. "Pays us" and "their business" answer the same
 * question from opposite ends: a clinic paying late while its bookings climb is a
 * billing conversation, and one paying late while its diary empties is a churn
 * conversation. Split across two screens, nobody holds both numbers at once.
 */

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const day = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const monthLabel = (d: Date) =>
  new Date(d).toLocaleDateString("en-PK", { month: "long", year: "numeric" });

const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
};

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

export function ClinicAnalyticsCard({ data }: { data: ClinicAnalytics }) {
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

  return (
    <div className="analytics-sheet space-y-6 text-sm">
      {/* ── Heading ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{clinic.name}</h2>
          <p className="text-xs text-muted-foreground">
            {[clinic.city, clinic.ownerName].filter(Boolean).join(" · ") || "No location recorded"}
            {clinic.monthlyPrice > 0 ? ` · ${rs(clinic.monthlyPrice)}/month` : " · No subscription price"}
          </p>
        </div>
        {grade ? (
          <div className="text-right">
            <div className={cn("font-heading text-xl font-bold", TONE[GRADE_META[grade].tone])}>
              {GRADE_META[grade].label}
            </div>
            <div className="text-xs text-muted-foreground">
              {behaviour.rating?.toFixed(1)} / 5 · {total} month{total === 1 ? "" : "s"} billed
            </div>
          </div>
        ) : null}
      </div>

      {/* ── A. Pays us ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Subscription payment behaviour
        </h3>

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
                Only {total} month{total === 1 ? "" : "s"} of history — treat the rating as
                provisional.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="On-time rate" value={pct(behaviour.onTimeRate)} hint={`over ${total} months`} />
              <Kpi
                label="Current status"
                value={behaviour.current ? payerLabel(behaviour.current) : "—"}
              />
              <Kpi label="Risk level" value={risk.label} tone={risk.tone} />
              <Kpi
                label="Owed to us"
                value={balance.owed > 0 ? rs(balance.owed) : "Nothing owed"}
                hint={
                  balance.owed > 0
                    ? `${balance.daysOverdue} day${balance.daysOverdue === 1 ? "" : "s"} overdue`
                    : balance.credit > 0
                      ? `${rs(balance.credit)} in credit`
                      : `Paid through ${day(balance.paidThrough)}`
                }
                tone={balance.owed > 0 ? (balance.billingStatus === "overdue" ? "bad" : "warn") : "good"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Category share */}
              <div className="rounded-lg border p-3">
                <div className="mb-2 text-xs font-medium">Category share</div>
                <ul className="space-y-1">
                  {PAYER_CATEGORIES.map((c) => {
                    const n = behaviour.counts[c.code] ?? 0;
                    return (
                      <li key={c.code} className="flex items-center justify-between gap-3">
                        <span className={cn("truncate", n === 0 && "text-muted-foreground")}>
                          {c.label}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {n} · {total ? Math.round((n / total) * 100) : 0}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Trend + the widening-window chart */}
              <div className="rounded-lg border p-3">
                <div className="mb-1 text-xs font-medium">Rating over time</div>
                <p className={cn("mb-3 text-xs", trendTone && TONE[trendTone])}>
                  {trendWord}
                  {trend.direction !== "unknown" && trend.recent !== null && trend.lifetime !== null
                    ? ` — last 3 months ${trend.recent.toFixed(1)} vs lifetime ${trend.lifetime.toFixed(1)}`
                    : ""}
                </p>
                <div className="flex h-28 items-end gap-2">
                  {windows.map((w) => (
                    <div key={w.months} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {w.rating === null ? "—" : w.rating.toFixed(1)}
                      </span>
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className={cn(
                            "w-full rounded-t",
                            w.rating === null ? "bg-muted" : "bg-primary/70",
                          )}
                          // Percentage of the 0–5 scale; a null window draws a stub so
                          // the axis stays readable rather than leaving a hole.
                          style={{ height: `${w.rating === null ? 2 : Math.max(4, (w.rating / 5) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{w.months}m</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend — the bands are ours, so they have to be stated */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {PAYER_CATEGORIES.map((c) => `${c.label} = ${c.hint}`).join(" · ")}
            </p>

            {/* Late & unpaid months */}
            {behaviour.months.some((m) => m.category !== "early" && m.category !== "on_time") ? (
              <div className="overflow-x-auto rounded-lg border">
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
                    {behaviour.months
                      .filter((m) => m.category !== "early" && m.category !== "on_time")
                      .reverse()
                      .map((m) => (
                        <tr key={m.dueAt.toISOString()} className="border-t">
                          <td className="px-3 py-2">{monthLabel(m.period)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{day(m.dueAt)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {m.settledAt ? day(m.settledAt) : "unpaid"}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {m.daysLate === null ? "—" : `${m.daysLate}`}
                          </td>
                          <td className="px-3 py-2">{payerLabel(m.category)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rs(m.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border p-3 text-xs text-muted-foreground">
                Every billed month was settled on or before its due date.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── B. Their business ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Clinic activity · {range.label}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <Kpi
            label="Collected"
            value={rs(business.collected)}
            hint="from their patients, this period"
          />
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
          <Kpi
            label="WhatsApp"
            value={`${business.whatsappOut} out`}
            hint={`${business.whatsappIn} in`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Last appointment booked {business.lastActivityAt ? day(business.lastActivityAt) : "— never"}.
          {clinic.activatedAt ? ` Subscription started ${day(clinic.activatedAt)}.` : ""}
        </p>
      </section>
    </div>
  );
}
