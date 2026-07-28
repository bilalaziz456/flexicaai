import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin, canManageTeam, canSeeBilling } from "@/core/auth/admin-permissions";
import { getCompanyMetrics } from "@/core/admin/metrics";
import { getClinicHealth, ANOMALY_META, type AnomalyFlag } from "@/core/admin/health";
import { getChurnInactiveDays, getAnomalyThresholds, CHURN_DAYS_OPTIONS } from "@/core/admin/company-settings";
import { listDueClinics } from "@/core/admin/billing";
import { FlagRulesForm } from "./flag-rules-form";
import { resolveSalesRange } from "@/core/sales/report";
import { OverviewFilters } from "./overview-filters";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { Badge } from "@/core/ui/badge";
import { ClinicStatusBadge } from "../clinics/status-badge";
import { cn } from "@/core/lib/utils";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const signed = (n: number) => `${n < 0 ? "−" : ""}Rs ${Math.abs(n).toLocaleString("en-PK")}`;
const ago = (d: Date | null, days: number | null) =>
  d === null || days === null ? "never" : days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;

function FlagBadges({ flags }: { flags: AnomalyFlag[] }) {
  return (
    <>
      {flags.map((f) => {
        const m = ANOMALY_META[f];
        return (
          <Badge
            key={f}
            variant="outline"
            title={m.hint}
            className={cn(
              "border-transparent",
              m.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {m.label}
          </Badge>
        );
      })}
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="gap-2">
      <CardHeader><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Owner Overview — the company at a glance: money (from getCompanyMetrics) + health
 * (getClinicHealth) + alerts (payments due, churn risk) + a per-clinic engagement /
 * usage / cost / margin table. Gated by `metrics:view`; the money columns
 * (MRR/serving cost/margin) show only with `revenue:view`. Scoped to the assignee for
 * a non-full-access team member, like the rest of the admin panel.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; days?: string }>;
}) {
  const user = await requireAdminCapability("metrics:view");
  const seesAll = canManageTeam(user);
  const showRevenue = canAdmin(user, "revenue:view");
  const showBilling = canSeeBilling(user);
  const scope = seesAll ? {} : { assignedTo: user.id };

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to);
  const rangeLabel = `${range.from} → ${range.to}`;

  // Churn threshold: the company DEFAULT (persisted in company_settings), overridden
  // by the `days` query param for this view. Only a full admin can save the default.
  const [defaultDays, anomaly] = await Promise.all([getChurnInactiveDays(), getAnomalyThresholds()]);
  const inactiveDays = (CHURN_DAYS_OPTIONS as readonly number[]).includes(Number(sp.days)) ? Number(sp.days) : defaultDays;
  const canSetDefault = seesAll; // full admins (owner/super_admin) set company-wide

  const [metrics, health, dueAll] = await Promise.all([
    getCompanyMetrics({ ...scope, withCost: showRevenue }),
    getClinicHealth(range, { ...scope, withCost: showRevenue, inactiveDays, anomaly }),
    showBilling ? listDueClinics() : Promise.resolve([]),
  ]);
  const due = seesAll ? dueAll : dueAll.filter((c) => c.assignedTo === user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            {seesAll ? "The whole company" : "Your assigned clinics"} at a glance — money, health &amp; usage.
          </p>
        </div>
        <Link href="/admin/finance" className="text-sm text-primary underline underline-offset-4">
          Full P&amp;L →
        </Link>
      </div>

      <OverviewFilters
        period={range.period}
        from={range.from}
        to={range.to}
        days={String(inactiveDays)}
        defaultDays={defaultDays}
        canSetDefault={canSetDefault}
      />

      {/* Money + health KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Clinics"
          value={String(metrics.totalClinics)}
          sub={`${metrics.clinicsByStatus.active ?? 0} active · ${metrics.clinicsByStatus.trial ?? 0} trial`}
        />
        <Kpi
          label="At risk (churn)"
          value={String(health.atRisk.length)}
          sub={`no activity ≥ ${health.inactiveDays}d`}
          tone={health.atRisk.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        {showBilling ? (
          <Kpi
            label="Overdue"
            value={rs(metrics.overdueTotal)}
            sub={`${metrics.overdueCount} clinic${metrics.overdueCount === 1 ? "" : "s"}`}
            tone={metrics.overdueTotal > 0 ? "text-destructive" : undefined}
          />
        ) : null}
        <Kpi label="Collected (period-to-date)" value={rs(metrics.collectedThisMonth)} sub={`${rs(metrics.collectedThisYear)} this year`} />
        {showRevenue ? (
          <>
            <Kpi label="MRR" value={rs(metrics.mrr)} sub={`${rs(metrics.mrr * 12)} ARR`} />
            <Kpi label="Serving cost (this month)" value={rs(metrics.servingCostThisMonth)} sub="AI scribe + WhatsApp" />
            <Kpi
              label="Gross margin (this month)"
              value={signed(metrics.grossMarginThisMonth)}
              sub="Collected − serving cost"
              tone={metrics.grossMarginThisMonth < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}
            />
            <Kpi
              label="Usage flags"
              value={String(health.flagged.length)}
              sub="cost / usage anomalies"
              tone={health.flagged.some((f) => f.flags.includes("loss")) ? "text-destructive" : health.flagged.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            />
          </>
        ) : null}
      </div>

      {/* Payments due / overdue */}
      {showBilling && due.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payments due / overdue ({due.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {due.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <Link href={`/admin/clinics/${c.id}`} className="truncate font-medium hover:underline">{c.name}</Link>
                  <span className={cn("shrink-0 tabular-nums", c.balance.billingStatus === "overdue" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}>
                    {c.balance.billingStatus === "overdue" ? `${rs(c.balance.owed)} · ${c.balance.daysOverdue}d` : `due · ${c.balance.daysOverdue}d`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* At-risk clinics — the actionable churn list (who to contact) */}
      <Card className={health.atRisk.length > 0 ? "border-amber-500/40" : undefined}>
        <CardHeader>
          <CardTitle>At-risk clinics ({health.atRisk.length})</CardTitle>
          <CardDescription>
            Live clinics quiet for ≥ {health.inactiveDays} days (or never active) — activity counts visits, appointments, WhatsApp &amp; staff logins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.atRisk.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Every live clinic is active. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead>Account manager</TableHead>
                    <TableHead>Contact</TableHead>
                    {showRevenue ? <TableHead className="text-right">MRR</TableHead> : null}
                    <TableHead className="text-right">Appts</TableHead>
                    <TableHead className="text-right">Scribe</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.atRisk.map((c) => (
                    <TableRow key={c.clinicId}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><ClinicStatusBadge status={c.status} /></TableCell>
                      <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400">{ago(c.lastActivityAt, c.daysInactive)}</TableCell>
                      <TableCell className="text-sm">{c.assigneeName ?? <span className="text-muted-foreground">unassigned</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.ownerPhone ?? c.ownerEmail ?? "—"}</TableCell>
                      {showRevenue ? <TableCell className="text-right tabular-nums">{rs(c.mrr)}</TableCell> : null}
                      <TableCell className="text-right tabular-nums">{c.appointments}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.scribeCalls}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/clinics/${c.clinicId}`} className="text-muted-foreground hover:text-foreground"><ChevronRight className="size-4" aria-hidden="true" /></Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flag rules (full admins) — always available so you can tune the thresholds. */}
      {showRevenue && canSetDefault ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Flag rules</CardTitle>
            <CardDescription>Company-wide thresholds for the usage/cost flags. The &ldquo;Cost &gt; MRR&rdquo; loss flag isn&apos;t tunable.</CardDescription>
          </CardHeader>
          <CardContent>
            <FlagRulesForm thinMarginPct={anomaly.thinMarginPct} spikeMultiple={anomaly.spikeMultiple} spikeFloorPkr={anomaly.spikeFloorPkr} />
          </CardContent>
        </Card>
      ) : null}

      {/* Usage / cost anomaly flags (cost-side → revenue:view) */}
      {showRevenue && health.flagged.length > 0 ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Usage flags ({health.flagged.length})</CardTitle>
            <CardDescription>
              Cost / usage anomalies over {rangeLabel} — cost ≥ {anomaly.thinMarginPct}% of MRR (high), &gt; MRR (loss), or ≥ {anomaly.spikeMultiple}× the prior period (spike).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>Account manager</TableHead>
                    <TableHead className="text-right">MRR</TableHead>
                    <TableHead className="text-right">Serving cost</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.flagged.map((c) => (
                    <TableRow key={c.clinicId}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-1"><FlagBadges flags={c.flags} /></div></TableCell>
                      <TableCell className="text-sm">{c.assigneeName ?? <span className="text-muted-foreground">unassigned</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(c.mrr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(c.servingCost)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", c.margin < 0 ? "text-destructive" : "")}>{signed(c.margin)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/clinics/${c.clinicId}`} className="text-muted-foreground hover:text-foreground"><ChevronRight className="size-4" aria-hidden="true" /></Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Per-clinic health / usage / cost */}
      <Card>
        <CardHeader>
          <CardTitle>Clinic activity &amp; usage ({rangeLabel})</CardTitle>
          <CardDescription>Quietest clinics first. Usage over the period; last-active is all-time.</CardDescription>
        </CardHeader>
        <CardContent>
          {health.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No clinics yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead className="text-right">Appts</TableHead>
                    <TableHead className="text-right">Scribe</TableHead>
                    <TableHead className="text-right">WhatsApp</TableHead>
                    <TableHead className="text-right">New pts</TableHead>
                    {showRevenue ? <TableHead className="text-right">Serving cost</TableHead> : null}
                    <TableHead className="text-right">Collected</TableHead>
                    {showRevenue ? <TableHead className="text-right">Margin</TableHead> : null}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.rows.map((c) => {
                    const stale = (c.status === "active" || c.status === "trial") && (c.daysInactive === null || c.daysInactive >= health.inactiveDays);
                    return (
                      <TableRow key={c.clinicId}>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.name}
                            {showRevenue ? <FlagBadges flags={c.flags} /> : null}
                          </div>
                        </TableCell>
                        <TableCell><ClinicStatusBadge status={c.status} /></TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ago(c.lastActivityAt, c.daysInactive)}
                          {stale ? <Badge variant="outline" className="ml-1.5 border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400">quiet</Badge> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.appointments}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.scribeCalls}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.whatsappOut}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.patientsNew}</TableCell>
                        {showRevenue ? <TableCell className="text-right tabular-nums">{rs(c.servingCost)}</TableCell> : null}
                        <TableCell className="text-right tabular-nums">{rs(c.collected)}</TableCell>
                        {showRevenue ? <TableCell className={cn("text-right tabular-nums", c.margin < 0 ? "text-destructive" : "")}>{signed(c.margin)}</TableCell> : null}
                        <TableCell className="text-right">
                          <Link href={`/admin/clinics/${c.clinicId}`} className="text-muted-foreground hover:text-foreground"><ChevronRight className="size-4" aria-hidden="true" /></Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
