import Link from "next/link";
import type { CompanyMetrics } from "@/core/admin/metrics";
import { CLINIC_STATUSES, CLINIC_STATUS_LABEL } from "@/core/clinics/status";
import { Sparkline } from "@/core/ui/sparkline";
import { cn } from "@/core/lib/utils";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

function Kpi({
  label,
  value,
  sub,
  tone,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      {children}
    </div>
  );
}

/**
 * Super-admin company dashboard (Feature 8) — the owner's "how much are WE earning"
 * view at the top of /admin. Pure server component (the sparkline is server-rendered
 * SVG). AI/WhatsApp cost + margin await Feature 7's unit-cost config.
 */
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
              tone={m.grossMarginThisMonth < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}
            />
          </>
        ) : null}
        <Kpi label="Collected this month" value={rs(m.collectedThisMonth)} sub={`${rs(m.collectedThisYear)} this year`}>
          <div className="mt-2">
            <Sparkline values={m.collectionTrend} color="var(--brand-teal)" ariaLabel="Collected — last 6 months" />
            <div className="mt-0.5 text-[10px] text-muted-foreground">Collected · last 6 months</div>
          </div>
        </Kpi>
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
        <div className="rounded-md border p-4">
          <div className="mb-2 text-sm font-medium">Clinics by status</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {CLINIC_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{CLINIC_STATUS_LABEL[s]}</span>
                <span className="font-semibold tabular-nums">{m.clinicsByStatus[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top clinics by revenue */}
        <div className="rounded-md border p-4">
          <div className="mb-2 text-sm font-medium">Top clinics by revenue (this year)</div>
          {m.topClinics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {m.topClinics.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <Link href={`/admin/clinics/${c.id}`} className="truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="tabular-nums text-muted-foreground">{rs(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
