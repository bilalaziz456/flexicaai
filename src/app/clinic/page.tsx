import { listUpcomingLeaves } from "@/core/appointments/availability";
import { getClinicDashboardCounts, getRecoveredCount, getRecoveredTrend } from "@/core/clinics/dashboard";
import Link from "next/link";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { clinicHasFeature } from "@/core/lib/features";
import { getClinic } from "@/core/clinics/get-clinic";
import { getSalesSummary, resolveSalesRange } from "@/core/sales/report";
import { getFinanceKpis } from "@/core/finance/kpis";
import { getNoShowStats } from "@/core/appointments/no-shows";
import { WaterfallChart } from "@/core/ui/charts/waterfall-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { Sparkline } from "@/core/ui/sparkline";
import { StatCard } from "@/core/ui/charts/stat-card";
import { OnboardingChecklist } from "@/core/ui/onboarding-checklist";
import { AvgVisitValueForm } from "./avg-visit-value-form";
import { DoctorLeaves } from "@/app/clinic/schedule/doctor-leaves";
import { clinicStaffSummary } from "@/core/db/vocabulary-cache";
import { DashboardPeriod } from "./dashboard-period";
import { PageDownloadPdf } from "@/core/ui/page-download-pdf";
import { PrintFileName } from "@/core/ui/print-file-name";
import { ReportPeriod, formatReportRange } from "@/core/ui/report-period";
import { dashboardPeriod } from "./dashboard-periods";

/**
 * Owner dashboard (CLAUDE.md §11 Step 12). The hero metric is "Revenue
 * Recovered": recall reminders that brought patients back = return visits ×
 * the owner's average visit value. Everything is clinic-scoped.
 */
export default async function ClinicDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireWorkspace();
  const { clinicId } = user;
  const isAdmin = user.role === "clinic_admin";
  const now = new Date();

  // ONE period drives every figure on the page (owner, 2026-11-11): Today, This month
  // (the default), 3 / 6 months, Year. Two figures are not period figures and say so:
  // upcoming appointments (ahead of now) and the doctors' unpaid shares (a balance).
  const per = dashboardPeriod((await searchParams).period);
  const range = resolveSalesRange(per.value, undefined, undefined);
  // The same window on the report a card links to. "This month" goes as dates, since
  // the report pages offer rolling presets only.
  const periodQs =
    range.period === "month" ? `period=custom&from=${range.from}&to=${range.to}` : `period=${range.period}`;
  // The hero sparkline: by day up to a month, by month beyond it.
  const recoveredUnit: "day" | "month" = per.value === "today" || per.value === "month" ? "day" : "month";

  // The Revenue dashboard is an optional, super-admin-gated feature (works for
  // any specialty). Fetch the clinic first so we can SKIP the expensive
  // "recovered" analytics query entirely when the feature is off (perf-first).
  // Deduped with the layout's fetch via cache() — one clinics read for the whole request.
  const clinicRow = await getClinic(clinicId);

  const revenueEnabled = clinicHasFeature(
    clinicRow?.featuresEnabled,
    "revenue_dashboard",
  );
  const salesEnabled = clinicHasFeature(clinicRow?.featuresEnabled, "sales");
  const avgVisitValue = clinicRow?.avgVisitValue ?? 3000;

  // KPIs split by concern: Collected + Outstanding are BILLING (any billing clinic
  // sees them); Net profit + Payable-to-doctors need the finance feature. Compute
  // once when either applies (perf-first — skip entirely otherwise).
  const billingKpiOn = salesEnabled && can(user, "billing", "view");
  const financeKpiOn =
    clinicHasFeature(clinicRow?.featuresEnabled, "finance") && can(user, "finance", "view");
  const financeKpis =
    billingKpiOn || financeKpiOn ? await getFinanceKpis(clinicId, range) : null;

  // A doctor manages their OWN leave right here on the dashboard (no separate
  // "Doctors" nav item). Fetch their upcoming leave; the add/remove controls are
  // gated by leave create/delete and the server action re-checks ownership.
  const isDoctor = user.role === "doctor";
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const myLeave = isDoctor
    ? await listUpcomingLeaves(clinicId, today, { doctorId: user.id })
    : [];

  // Net sales over the period for the dashboard card (only when the feature is on).
  // Runs in parallel with the other stats below.
  const salesSummaryPromise = salesEnabled
    ? getSalesSummary(clinicId, range)
    : Promise.resolve(null);

  // No-show rate — operational, shown to anyone who can see appointments.
  const noShowPromise = can(user, "appointments", "view")
    ? getNoShowStats(clinicId, range)
    : Promise.resolve(null);

  const [counts, recovered, recoveredTrendRows] = await Promise.all([
    getClinicDashboardCounts(clinicId, now, range),
    // Only run the metric queries when the Revenue feature is on.
    revenueEnabled ? getRecoveredCount(clinicId, range) : Promise.resolve(0),
    revenueEnabled ? getRecoveredTrend(clinicId, range, recoveredUnit) : Promise.resolve([]),
  ]);

  // First-run setup guide — shown to the clinic admin until the three essentials are
  // in place, then it hides itself (no manual dismiss needed).
  const onboardingSteps = isAdmin
    ? [
        { label: "Add your team", description: "Invite doctors and receptionists.", href: "/clinic/staff", cta: "Add team member", done: counts.staff > 0 },
        { label: "Add your first patient", description: "Register a patient to start booking.", href: "/clinic/patients", cta: "Add patient", done: counts.patients > 0 },
        { label: "Book the first appointment", description: "Schedule a visit for a patient.", href: "/clinic/appointments/new", cta: "Book", done: counts.appointmentsEver > 0 },
      ]
    : [];
  const showOnboarding = onboardingSteps.length > 0 && onboardingSteps.some((s) => !s.done);

  const revenueRecovered = recovered * avgVisitValue;
  // Recovered return visits through the period, gap-filled by day or month → the
  // sparklines. The hero shows recovered REVENUE (counts × average visit value); the
  // stat card below shows the visits themselves, so it needs the counts unconverted.
  const recoveredCounts = (() => {
    const byKey = new Map<string, number>();
    for (const r of recoveredTrendRows) byKey.set(r.m, Number(r.n));
    const p2 = (n: number) => String(n).padStart(2, "0");
    const out: number[] = [];
    const d = new Date(range.start);
    if (recoveredUnit === "month") d.setDate(1);
    while (d < range.end) {
      const key =
        recoveredUnit === "day"
          ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
          : `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
      out.push(byKey.get(key) ?? 0);
      if (recoveredUnit === "day") d.setDate(d.getDate() + 1);
      else d.setMonth(d.getMonth() + 1);
    }
    return out;
  })();
  const recoveredTrend = recoveredCounts.map((n) => n * avgVisitValue);
  const pkr = (n: number) =>
    new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
      maximumFractionDigits: 0,
    }).format(n);
  const money = pkr(revenueRecovered);

  // Collect the parallel sales summary (already running since it was created).
  const salesSummary = await salesSummaryPromise;
  const noShow = await noShowPromise;

  // "Return visits" only means something alongside the Revenue metric, so it is
  // shown only when that feature is enabled. Outstanding leads the stats grid (a
  // plain "Patients owe us" card) for a symmetric layout — it only means something
  // for a billing clinic, so it's gated the same as the old KPI card.
  const stats = [
    ...(billingKpiOn && financeKpis
      ? [
          {
            title: "Outstanding",
            value: pkr(financeKpis.outstandingReceivable),
            note: `Patients owe us for visits ${per.phrase}`,
            href: "/clinic/appointments?status=completed&payment=unpaid",
            // What is owed, running through the period — it ends at the figure.
            trend: financeKpis.outstandingTrend,
            // A rising balance is money we have not been paid, so up is the bad
            // direction here — the opposite of every other figure on this row.
            higherIsBetter: false,
          },
        ]
      : []),
    ...(financeKpiOn && financeKpis
      ? [
          {
            title: "Payable to doctors",
            value: pkr(financeKpis.payableToDoctors),
            // A balance owed as a whole, not a period figure — so it says "today".
            note: "Unpaid shares, as of today",
            href: "/clinic/shares",
            // The running unpaid balance through the period. It ENDS at the figure
            // above it by construction — see `getPayableTrend`.
            trend: financeKpis.payableTrend,
            // Owing doctors more is not a win: the balance going up means we have
            // not settled, which is the same reading as the receivable above.
            higherIsBetter: false,
          },
        ]
      : []),
    ...(salesEnabled && salesSummary
      ? [
          {
            title: `Net sales (${per.suffix})`,
            value: pkr(salesSummary.netTotal),
            // Daily net sales, summed from the very rows that produced the total.
            trend: salesSummary.trend,
            note: `${salesSummary.count} completed visit${salesSummary.count === 1 ? "" : "s"} · View report`,
            href: `/clinic/sales?${periodQs}`,
          },
        ]
      : []),
    ...(revenueEnabled
      ? [
          {
            title: "Return visits",
            value: recovered,
            note: `From recall reminders, ${per.phrase}`,
            // The same buckets the hero converts into money.
            trend: recoveredCounts,
          },
        ]
      : []),
    { title: "Recalls sent", value: counts.recallsSent, note: `Reminders sent ${per.phrase}`, href: "/clinic/recalls" },
    // Ahead of now, whatever the period — a past window has no "upcoming".
    { title: "Upcoming appts", value: counts.upcoming, note: "Scheduled from now on", href: "/clinic/appointments" },
    ...(noShow && noShow.attended > 0
      ? [
          {
            title: `No-show rate (${per.suffix})`,
            value: `${(noShow.rate * 100).toFixed(1)}%`,
            note: `${noShow.noShow} of ${noShow.attended} missed`,
            href: `/clinic/no-shows?${periodQs}`,
          },
        ]
      : []),
    {
      title: "New patients",
      value: counts.newPatients,
      note: `Registered ${per.phrase} · ${counts.patients} in all`,
      href: "/clinic/patients",
    },
    { title: "Team", value: counts.staff, note: clinicStaffSummary(), href: "/clinic/staff" },
  ];

  return (
    <div className="space-y-6">
      {/* "Download PDF" saves the dashboard as it stands for the chosen period (owner,
          2026-11-11). The picker, buttons, setup guide and forms are screen controls
          and are left out; <ReportPeriod> writes the dates into the file instead. */}
      <PrintFileName name={`Dashboard ${clinicRow?.name ?? ""} ${formatReportRange(range.start, range.end)}`.replace(/\s+/g, " ")} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your clinic at a glance.
          </p>
          <ReportPeriod range={range} extra={clinicRow?.name} />
        </div>
        <div className="no-print flex flex-wrap items-end gap-3">
          <DashboardPeriod period={per.value} />
          {/* The buttons sit on the period pills' centre line: the pill group is 34px
              tall (h-7 + padding + border) and a small button 28px, so bottom-aligning
              them left the buttons visibly low. Download PDF first, then Day book. */}
          <div className="flex h-[2.125rem] items-center gap-2">
            <PageDownloadPdf />
            {/* Gated on billingKpiOn, NOT financeKpiOn: the day book needs the sales
                feature + billing:view, so gating on finance would show the button to a
                clinic that lands on a notFound(). Same predicate the page itself uses. */}
            {billingKpiOn ? (
              <Link
                href="/clinic/reports/daybook"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Day book
                <ArrowRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {showOnboarding ? (
        <div className="no-print">
          <OnboardingChecklist steps={onboardingSteps} />
        </div>
      ) : null}

      {/* Finance KPIs — mirror the P&L cards: Collected − Doctor shares − Expenses =
          Net profit. The share bill is scored NEUTRAL: this page once called a FALLING
          share bill good while /clinic/pl called a RISING one good, so the same figure
          was green on two screens for opposite reasons. It tracks revenue; it is not a
          win or a loss on its own.
          Net profit (colours match the P&L chart, except Expenses is yellow here).
          Payable-to-doctors + Outstanding live in the stats grid below. */}
      {financeKpis ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const fmt = (n: number) =>
              new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
            const loss = financeKpis.netProfit < 0;
            const sfx = `(${per.suffix})`;
            const kpis = [
              { show: billingKpiOn || financeKpiOn, title: `Collected ${sfx}`, value: fmt(financeKpis.collected), note: "Revenue received", href: financeKpiOn ? `/clinic/pl?${periodQs}` : `/clinic/sales?${periodQs}`, tone: "default" as const, trend: financeKpis.collectedTrend, curr: financeKpis.collected, prev: financeKpis.collectedPrev, up: true, tint: "var(--color-chart-1)" },
              { show: financeKpiOn, title: `Doctor shares ${sfx}`, value: `− ${fmt(financeKpis.doctorShares)}`, note: "Earned on collection", href: `/clinic/pl?${periodQs}`, tone: "default" as const, trend: financeKpis.sharesTrend, curr: financeKpis.doctorShares, prev: financeKpis.doctorSharesPrev, up: "neutral" as const, tint: "var(--color-chart-2)" },
              { show: financeKpiOn, title: `Expenses ${sfx}`, value: `− ${fmt(financeKpis.expenses)}`, note: "Costs incurred", href: `/clinic/expenses?${periodQs}`, tone: "default" as const, trend: financeKpis.expenseTrend, curr: financeKpis.expenses, prev: financeKpis.expensesPrev, up: false, tint: "var(--color-warning)" },
              { show: financeKpiOn, title: loss ? `Net loss ${sfx}` : `Net profit ${sfx}`, value: fmt(Math.abs(financeKpis.netProfit)), note: "After shares + expenses", href: `/clinic/pl?${periodQs}`, tone: (loss ? "bad" : "good") as "bad" | "good", trend: financeKpis.profitTrend, curr: financeKpis.netProfit, prev: financeKpis.netProfitPrev, up: true, tint: loss ? "var(--color-destructive)" : "var(--color-success)" },
            ].filter((k) => k.show);
            return kpis.map((k) => (
              <Link key={k.title} href={k.href} className="h-full">
                <StatCard
                  className="h-full transition-colors hover:border-primary/50"
                  label={k.title}
                  value={k.value}
                  hint={k.note}
                  trend={k.trend}
                  current={k.curr}
                  previous={k.prev}
                  higherIsBetter={k.up}
                  // The same hue this measure wears in the money-flow chart below.
                  trendColor={k.tint}
                  tone={k.tone}
                  comparisonLabel={per.compare}
                />
              </Link>
            ));
          })()}
        </div>
      ) : null}

      {/* Money flow over the period — collected → −shares → −expenses → profit
          (finance only). The SAME window as the KPI cards above; hidden when nothing
          was collected in it. */}
      {financeKpiOn && financeKpis && financeKpis.collected > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Money flow ({per.suffix})</CardTitle>
                <CardDescription>How the revenue collected {per.phrase} became profit.</CardDescription>
              </div>
              <Link
                href={`/clinic/pl?${periodQs}`}
                className="inline-flex min-h-7 items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Full report
                <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <WaterfallChart
              ariaLabel={`Revenue collected ${per.phrase} to net profit`}
              steps={[
                { label: "Collected", value: financeKpis.collected, role: "start" },
                { label: "− Shares", value: -financeKpis.doctorShares, role: "deduct", color: "var(--color-chart-2)" },
                { label: "− Expenses", value: -financeKpis.expenses, role: "deduct", color: "var(--color-warning)" },
                { label: financeKpis.netProfit < 0 ? "Net loss" : "Net profit", value: financeKpis.netProfit, role: "result" },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Supporting stats — ONE panel divided, rather than eight separate cards.
          These are the clinic's second-order numbers (counts, a rate, a balance) and
          as individual bordered cards they carried exactly the same visual weight as
          the money KPIs above, so the page had twelve equal headlines and therefore
          no headline at all. Grouped behind one border with hairline dividers they
          read as a single supporting block, which is what they are. */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
          {stats.map((s, i) => {
            const inner = (
              <StatCard
                variant="quiet"
                className={cn(
                  "h-full p-5 transition-colors",
                  // The dividers are drawn per cell rather than by `divide-x`, because
                  // the column count changes at two breakpoints and `divide-*` cannot
                  // follow it — it would leave a rule hanging at the end of a row.
                  "sm:border-b sm:border-border/60",
                  i % 2 === 0 && "sm:border-r sm:border-border/60",
                  // The last cell drops its right rule: the grid rarely divides
                  // evenly, so otherwise a divider hangs in the empty tail of the row.
                  i === stats.length - 1 ? "lg:border-r-0" : "lg:border-r",
                  s.href &&
                    "hover:bg-foreground/[0.02]",
                )}
                label={s.title}
                value={String(s.value)}
                hint={s.note}
                trend={"trend" in s ? s.trend : undefined}
                higherIsBetter={"higherIsBetter" in s ? s.higherIsBetter : true}
              />
            );
            return s.href ? (
              <Link key={s.title} href={s.href} className="block">
                {inner}
              </Link>
            ) : (
              <div key={s.title} className="block">
                {inner}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Revenue Recovered — at the foot of the figures (owner, 2026-11-11; it used to
          lead the page), when the super admin enabled it. */}
      {revenueEnabled ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardDescription>Revenue recovered ({per.suffix})</CardDescription>
            <CardTitle className="text-4xl text-primary-text">{money}</CardTitle>
            <CardDescription>
              {recovered} return visit{recovered === 1 ? "" : "s"} driven by
              recall reminders ×{" "}
              {new Intl.NumberFormat("en-PK").format(avgVisitValue)} PKR average
              visit value.
            </CardDescription>
          </CardHeader>
          {(recoveredTrend.length > 1 && recoveredTrend.some((v) => v > 0)) || isAdmin ? (
            <CardContent className="space-y-3">
              {recoveredTrend.length > 1 && recoveredTrend.some((v) => v > 0) ? (
                <div>
                  <Sparkline values={recoveredTrend} color="var(--brand-teal)" ariaLabel={`Revenue recovered ${per.phrase}`} />
                  <p className="text-xs text-muted-foreground">Recovered revenue · {per.title.toLowerCase()}</p>
                </div>
              ) : null}
              {isAdmin ? (
                <div className="no-print">
                  <AvgVisitValueForm value={avgVisitValue} />
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* Doctor: manage your own leave / vacation (no separate nav page) — kept
          at the end of the dashboard. */}
      {isDoctor ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>My leave</CardTitle>
            <CardDescription>
              Add your leave / vacation days. Appointments in the range are
              cancelled and no new bookings are allowed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorLeaves
              doctorId={user.id}
              leaves={myLeave}
              canCreate={can(user, "leave", "create")}
              canEdit={can(user, "leave", "edit")}
              canDelete={can(user, "leave", "delete")}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
