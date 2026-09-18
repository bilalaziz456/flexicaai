import Link from "next/link";
import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getSharesReport } from "@/core/sales/share-report";
import { getDoctorBalances, listPayouts } from "@/core/sales/payouts";
import { listSettlementActions } from "@/core/sales/settlement-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { TrendChart } from "@/core/ui/charts/trend-chart";
import { StatCard } from "@/core/ui/charts/stat-card";
import { ShareRings } from "@/core/ui/charts/share-rings";
import { Trend3D } from "@/core/ui/charts/trend-3d";
import { ChartViewToggle } from "@/core/ui/charts/chart-view-toggle";
import { SalesFilters } from "@/core/ui/report-filters";
import { RecordPayoutForm } from "./payout-ui";
import { SettlementForm, VoidSettlementButton } from "./settlement-ui";
import { BalancesTable, PayoutsTable } from "./shares-tables";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Revenue-share earnings + payments. Balances (Earned / Paid / Outstanding) are
 * LIFETIME and amount-based; the period filter scopes only the earnings-over-time
 * chart. A DOCTOR sees only their own; a clinic admin sees every doctor and can
 * record an arbitrary (partial) payment against a doctor's outstanding balance.
 */
export default async function ClinicSharesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; doctorId?: string }>;
}) {
  const user = await requireWorkspace("shares");
  const { clinicId } = user;
  const selfOnly = user.role === "doctor";
  const isAdmin = user.role === "clinic_admin";

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, (await getClinic(clinicId))?.createdAt);
  const doctorId = selfOnly ? user.id : sp.doctorId?.trim() || null;
  const singleDoctor = selfOnly || Boolean(doctorId);

  const canWaive = can(user, "share_waive", "view");
  const [balances, report, payouts, doctors, settlementActions] = await Promise.all([
    getDoctorBalances(clinicId, doctorId),
    getSharesReport(clinicId, range, doctorId),
    listPayouts(clinicId, doctorId),
    selfOnly ? Promise.resolve([]) : getSalesDoctors(clinicId),
    singleDoctor && doctorId ? listSettlementActions(clinicId, doctorId) : Promise.resolve([]),
  ]);

  // Balance figures: one doctor when scoped, else clinic-wide totals.
  const scoped = singleDoctor
    ? (balances[0] ?? { earned: 0, borne: 0, adjustments: 0, paid: 0, outstanding: 0 })
    : {
        earned: balances.reduce((s, b) => s + b.earned, 0),
        borne: balances.reduce((s, b) => s + b.borne, 0),
        adjustments: balances.reduce((s, b) => s + b.adjustments, 0),
        paid: balances.reduce((s, b) => s + b.paid, 0),
        outstanding: balances.reduce((s, b) => s + b.outstanding, 0),
      };

  // Lifetime per-doctor balances CSV (mirrors the "By doctor" table); scoped when a
  // single doctor is in view.
  const exportParams = new URLSearchParams({ type: "shares" });
  if (doctorId) exportParams.set("doctorId", doctorId);

  // Discount bearing + waives net (so Earned + this − Paid = Outstanding).
  const netAdjust = scoped.borne + scoped.adjustments;
  const owes = scoped.outstanding < 0;
  const summary = [
    { title: "Earned", value: money.format(scoped.earned), note: selfOnly ? "Your lifetime share" : "Doctor shares, all time", tone: "" },
    ...(netAdjust !== 0
      ? [{
          title: "Discount adjustment",
          value: money.format(netAdjust),
          note: "Bearing + waives",
          tone: netAdjust < 0 ? "text-destructive" : "text-success-text",
        }]
      : []),
    { title: "Paid", value: money.format(scoped.paid), note: "Settled to date", tone: "" },
    {
      title: owes ? "Owes clinic" : "Outstanding",
      value: money.format(Math.abs(scoped.outstanding)),
      note: owes ? "Doctor owes the clinic" : "Still owed",
      tone: owes ? "text-destructive" : "",
    },
  ];

  // Composition of lifetime earnings. Only positive earners: a doctor who net-bore
  // a discount has a NEGATIVE balance, and a negative slice of a ring is not a
  // thing — it would have to be drawn as an absence, which no reader would decode.
  const shareSlices = balances
    .filter((b) => b.earned > 0)
    .map((b) => ({ label: b.name, value: b.earned }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Revenue shares</h1>
          <p className="text-sm text-muted-foreground">
            {selfOnly
              ? "Your share of completed visits, and what's been paid."
              : "What each doctor has earned from completed visits, and what's owed."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {balances.length > 0 ? (
            <a
              href={`/api/finance/export?${exportParams.toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
            >
              <Download className="size-3.5" aria-hidden="true" /> CSV
            </a>
          ) : null}
          {singleDoctor ? (
            <Link
              href={selfOnly ? "/clinic/shares/statement" : `/clinic/shares/statement?doctorId=${doctorId}`}
              className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              View statement
            </Link>
          ) : null}
        </div>
      </div>

      {/* Balance (lifetime) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <StatCard
            key={s.title}
            label={s.title}
            value={s.value}
            hint={s.note}
            tone={s.tone.includes("destructive") ? "bad" : s.tone ? "good" : "default"}
          />
        ))}
      </div>

      {/* Record a payment — clinic admin, scoped to one doctor with a balance. */}
      {isAdmin && doctorId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record payment</CardTitle>
            <CardDescription>
              Pay any amount against this doctor&apos;s outstanding balance (partial
              is fine).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scoped.outstanding > 0 ? (
              <RecordPayoutForm doctorId={doctorId} outstanding={scoped.outstanding} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding for this doctor.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Settle balance — waive / write-off / repayment (share_waive), or a doctor
          waiving his own owed share (self). */}
      {singleDoctor && doctorId && (canWaive || (selfOnly && scoped.outstanding > 0)) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settle balance</CardTitle>
            <CardDescription>
              {owes
                ? "Forgive the debt, write it off, or record the doctor's repayment."
                : "Waive part of what's owed to this doctor."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettlementForm
              key={scoped.outstanding}
              doctorId={doctorId}
              outstanding={scoped.outstanding}
              canClinic={canWaive}
              canDoctorWaive={canWaive || selfOnly}
            />
            {settlementActions.length > 0 ? (
              <ul className="divide-y rounded-lg border text-sm">
                {settlementActions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <span className="font-medium">
                        {vocabularyLabel("settlement_kinds", a.kind)} · {money.format(a.amount)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {a.createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        {a.createdByName ? ` · by ${a.createdByName}` : ""}
                        {a.note ? ` · ${a.note}` : ""}
                      </span>
                    </div>
                    {canWaive ? <VoidSettlementButton actionId={a.id} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Share of earnings — one ring per doctor, every arc swept from twelve
          o'clock so near-equal shares can actually be ranked. See `share-rings.tsx`
          for why this is not a donut. */}
      {!singleDoctor && shareSlices.length > 1 ? (
        <Card className="overflow-hidden border-border/60 bg-linear-to-b from-card to-muted/20">
          <CardHeader>
            <CardTitle className="text-base">Share of earnings</CardTitle>
            <CardDescription>
              How lifetime earnings divide across the clinic&apos;s doctors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ShareRings
              rows={shareSlices}
              centerLabel="Total earned"
              unitLabel={`${shareSlices.length} doctors`}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Per-doctor balances (full, unscoped view) — click a doctor to pay them. */}
      {!singleDoctor ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By doctor</CardTitle>
            <CardDescription>Lifetime earned, paid and outstanding.</CardDescription>
          </CardHeader>
          <CardContent>
            <BalancesTable rows={balances} />
          </CardContent>
        </Card>
      ) : null}

      {/* Earnings over time (period-filtered analysis) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Earned vs paid over time</CardTitle>
              <CardDescription>
                {money.format(report.shareTotal)} earned · {money.format(report.paidTotal)} paid
                in the selected period.
                {doctorId ? (
                  <>
                    {" "}
                    <Link href="/clinic/shares" className="underline underline-offset-4">
                      Show all doctors
                    </Link>
                  </>
                ) : null}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SalesFilters
            period={range.period}
            from={range.from}
            to={range.to}
            doctorId={selfOnly ? "" : (doctorId ?? "")}
            doctors={doctors}
            showDoctor={!selfOnly}
          />
          {report.count === 0 && report.paidTotal === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No earnings or payments in this period.
            </p>
          ) : (
            <div className="space-y-8">
              <ChartViewToggle
                label="Earned vs paid per period"
                flat={
                  <TrendChart
                    ariaLabel={selfOnly ? "Your earned vs paid per period" : "Doctor shares earned vs paid per period"}
                    points={report.activityBuckets.map((b) => ({
                      label: b.label,
                      value: b.earned,
                      second: b.paid,
                    }))}
                    valueLabel="Earned"
                    overlay={{ label: "Paid" }}
                  />
                }
                deep={
                  <Trend3D
                    ariaLabel="Earned vs paid per period, three-dimensional"
                    points={report.activityBuckets.map((b) => ({
                      label: b.label,
                      value: b.earned,
                      second: b.paid,
                    }))}
                    valueLabel="Earned"
                    overlayLabel="Paid"
                  />
                }
                note={
                  <>
                    Values sit further from the axis than in the flat chart — the rails run
                    forward to help carry one across.
                  </>
                }
              />
              <div>
                <div className="text-sm font-medium">Cumulative earned vs paid</div>
                <p className="mb-3 text-xs text-muted-foreground">
                  The gap between the lines is the outstanding balance over time.
                </p>
                {/* The GAP is the point of this chart — what the clinic still owes
                    — so it is tinted rather than left for the eye to measure. */}
                <ChartViewToggle
                  label="Cumulative earned vs paid"
                  flat={
                    <TrendChart
                      ariaLabel="Cumulative earned versus paid"
                      points={report.cumulativeBuckets.map((b) => ({
                        label: b.label,
                        value: b.earned,
                        second: b.paid,
                      }))}
                      valueLabel="Cumulative earned"
                      mode="line"
                      overlay={{
                        label: "Cumulative paid",
                        fillGap: true,
                        gapLabel: "Outstanding",
                      }}
                    />
                  }
                  deep={
                    <Trend3D
                      ariaLabel="Cumulative earned versus paid, three-dimensional"
                      points={report.cumulativeBuckets.map((b) => ({
                        label: b.label,
                        value: b.earned,
                        second: b.paid,
                      }))}
                      valueLabel="Cumulative earned"
                      overlayLabel="Cumulative paid"
                    />
                  }
                  note={
                    <>
                      The two curtains stand on different planes, so the space between them
                      is part balance and part perspective. Read the exact outstanding figure
                      from the hover; this view is for the shape.
                    </>
                  }
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
          <CardDescription>
            {singleDoctor ? "Recorded payments." : "Recent payments across doctors."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PayoutsTable rows={payouts} singleDoctor={singleDoctor} isAdmin={isAdmin} />
        </CardContent>
      </Card>
    </div>
  );
}
