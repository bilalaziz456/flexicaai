import { HandCoins } from "lucide-react";
import { EmptyState } from "@/core/ui/empty-state";
import { SegmentedBar } from "@/core/ui/charts/segmented-bar";
import { StatCard } from "@/core/ui/charts/stat-card";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import type { CompanyMetrics } from "@/core/admin/metrics";
import { CLINIC_STATUSES } from "@/core/clinics/status";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * The company KPI — the SAME component the clinic panel uses.
 *
 * It was a private div with `rounded-md border` and no fill (the same latent bug as
 * the filter bars, invisible while the page ground was white) and its own label and
 * figure styling, so the owner's headline numbers were set differently from a
 * clinic's on the screen next door.
 *
 * `tone` arrives as a raw class name from the six call sites and is MAPPED to
 * StatCard's good/bad rather than plumbed through: a component that accepts an
 * arbitrary colour class is how two places end up disagreeing about what red means.
 *
 * The declared `children` prop was never passed by any caller, so it is gone.
 */
function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  const semantic = tone?.includes("destructive")
    ? ("bad" as const)
    : tone?.includes("success")
      ? ("good" as const)
      : ("default" as const);
  return <StatCard label={label} value={value} hint={sub} tone={semantic} />;
}

/**
 * Super-admin company dashboard (Feature 8) — the owner's "how much are WE earning"
 * view at the top of /admin. Pure server component (the sparkline is server-rendered
 * SVG). AI/WhatsApp cost + margin await Feature 7's unit-cost config.
 */
/**
 * Status colours for the portfolio bar. Trial and active are the healthy half, the
 * rest escalate — so the bar reads left to right as a lifecycle AND as a temperature.
 */
const STATUS_COLOUR: Record<string, string> = {
  trial: "var(--color-chart-2)",
  active: "var(--color-success)",
  suspended: "var(--color-warning)",
  past_due: "var(--color-chart-4)",
  cancelled: "var(--color-destructive)",
};

export function CompanyMetricsPanel({
  metrics,
  scoped = false,
  showRevenue = false,
}: {
  metrics: CompanyMetrics;
  /** True for a scoped team member — the figures cover only their assigned clinics. */
  scoped?: boolean;
  /** Gate the headline recurring-revenue figures (MRR + ARR) on `revenue:view`.
   *  When false the card is not rendered at all (server component — value never
   *  reaches the browser). */
  showRevenue?: boolean;
}) {
  const m = metrics;
  const arr = m.mrr * 12; // Annual Recurring Revenue = MRR × 12.
  return (
    <section className="space-y-4">
      {scoped ? (
        <p className="text-xs text-muted-foreground">Figures below cover your assigned clinics only.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showRevenue ? (
          <Kpi label="MRR (active plans)" value={rs(m.mrr)} sub={`${rs(arr)} / year (ARR) · ${m.newThisMonth} new this month`} />
        ) : null}
        {showRevenue && m.hasCost ? (
          <>
            <Kpi label="Serving cost (this month)" value={rs(m.servingCostThisMonth)} sub="AI scribe + WhatsApp" />
            <Kpi
              label="Gross margin (this month)"
              value={`${m.grossMarginThisMonth < 0 ? "−" : ""}${rs(Math.abs(m.grossMarginThisMonth))}`}
              sub="Collected − serving cost"
              tone={m.grossMarginThisMonth < 0 ? "text-destructive" : "text-success-text"}
            />
          </>
        ) : null}
        <Kpi label="Collected this month" value={rs(m.collectedThisMonth)} sub={`${rs(m.collectedThisYear)} this year`} />
        <Kpi
          label="Overdue"
          value={rs(m.overdueTotal)}
          sub={`${m.overdueCount} clinic${m.overdueCount === 1 ? "" : "s"} due / overdue`}
          tone={m.overdueTotal > 0 ? "text-destructive" : undefined}
        />
        <Kpi label="Total clinics" value={String(m.totalClinics)} sub={`${m.clinicsByStatus.active ?? 0} active · ${m.clinicsByStatus.trial ?? 0} trial`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Clinics by status */}
        <div className="rounded-xl border border-border/70 bg-card p-5 elev-1">
          <div className="mb-2 text-sm font-medium">Clinics by status</div>
          {/* The portfolio as ONE bar. It was a row of count chips, which asserts a
              split without showing it — five numbers you have to add up to know
              whether "3 suspended" is a rounding error or a third of the book.
              Lifecycle order, never sorted by size: the bar would reshuffle itself
              every time a clinic changed state. */}
          <SegmentedBar
            ariaLabel="Clinics by status"
            segments={CLINIC_STATUSES.map((s) => ({
              label: vocabularyLabel("clinic_statuses", s),
              value: m.clinicsByStatus[s] ?? 0,
              color: STATUS_COLOUR[s] ?? "var(--color-chart-3)",
            }))}
          />
          {/* Billing heads-up: payments coming up soon + amounts due/overdue. */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t pt-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-info-text">Payments coming up</span>
              <span className="font-semibold tabular-nums">{m.upcomingCount}</span>
              {m.upcomingTotal > 0 ? (
                <span className="text-xs text-muted-foreground">({rs(m.upcomingTotal)})</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-warning-text">Due / overdue</span>
              <span className="font-semibold tabular-nums">{m.overdueCount}</span>
            </div>
          </div>
        </div>

        {/* Top clinics by revenue */}
        <div className="rounded-xl border border-border/70 bg-card p-5 elev-1">
          <div className="mb-2 text-sm font-medium">Top clinics by revenue (this year)</div>
          {m.topClinics.length === 0 ? (
            <EmptyState
              compact
              icon={HandCoins}
              title="No payments recorded yet"
              description="Clinics appear here once a subscription payment is logged against them."
            />
          ) : (
            /* A ranking with no encoding at all — five names and five figures, and
               the reader compares the digits. The dot puts them on one scale, and
               the share says how concentrated the company's revenue is. */
            <LollipopChart
              ariaLabel="Top clinics by revenue"
              showShare
              rows={m.topClinics.map((c) => ({
                label: c.name,
                value: c.total,
                href: `/admin/clinics/${c.id}`,
              }))}
            />
          )}
        </div>
      </div>
    </section>
  );
}
