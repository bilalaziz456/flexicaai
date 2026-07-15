import Link from "next/link";
import { and, asc, count, eq, gte, inArray, sql } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import {
  appointments,
  clinics,
  doctorLeaves,
  patients,
  recalls,
  users,
} from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesSummary, resolveSalesRange } from "@/core/sales/report";
import { getFinanceKpis } from "@/core/finance/kpis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AvgVisitValueForm } from "./avg-visit-value-form";
import { DoctorLeaves } from "@/app/reception/doctor-leaves";
import { CLINIC_STAFF_ROLES, CLINIC_STAFF_SUMMARY } from "@/core/types/auth";

/**
 * Owner dashboard (CLAUDE.md §11 Step 12). The hero metric is "Revenue
 * Recovered": recall reminders that brought patients back = return visits ×
 * the owner's average visit value. Everything is clinic-scoped.
 */
export default async function ClinicDashboard() {
  const user = await requireWorkspace();
  const { clinicId } = user;
  const isAdmin = user.role === "clinic_admin";
  const now = new Date();

  // The Revenue dashboard is an optional, super-admin-gated feature (works for
  // any specialty). Fetch the clinic first so we can SKIP the expensive
  // "recovered" analytics query entirely when the feature is off (perf-first).
  const [clinicRow] = await db
    .select({
      avgVisitValue: clinics.avgVisitValue,
      featuresEnabled: clinics.featuresEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

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
  const financeKpis = billingKpiOn || financeKpiOn ? await getFinanceKpis(clinicId) : null;

  // A doctor manages their OWN leave right here on the dashboard (no separate
  // "Doctors" nav item). Fetch their upcoming leave; the add/remove controls are
  // gated by leave create/delete and the server action re-checks ownership.
  const isDoctor = user.role === "doctor";
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const myLeave = isDoctor
    ? await db
        .select({
          id: doctorLeaves.id,
          startDate: doctorLeaves.startDate,
          endDate: doctorLeaves.endDate,
          reason: doctorLeaves.reason,
        })
        .from(doctorLeaves)
        .where(
          byClinic(
            doctorLeaves.clinicId,
            clinicId,
            notDeleted(doctorLeaves.deletedAt),
            and(
              eq(doctorLeaves.doctorId, user.id),
              gte(doctorLeaves.endDate, today),
            ),
          ),
        )
        .orderBy(asc(doctorLeaves.startDate))
    : [];

  // Net sales over the last 30 days for the dashboard card (only when the feature
  // is on). Runs in parallel with the other stats below.
  const salesSummaryPromise = salesEnabled
    ? getSalesSummary(clinicId, resolveSalesRange("30d", undefined, undefined))
    : Promise.resolve(null);

  const [[staff], [patientRows], [recallsSent], [upcoming], recoveredRes] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(users)
        .where(
          and(
            eq(users.clinicId, clinicId),
            notDeleted(users.deletedAt),
            inArray(users.role, [...CLINIC_STAFF_ROLES]),
          ),
        ),
      db
        .select({ value: count() })
        .from(patients)
        .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt))),
      db
        .select({ value: count() })
        .from(recalls)
        .where(
          byClinic(
            recalls.clinicId,
            clinicId,
            notDeleted(recalls.deletedAt),
            inArray(recalls.status, ["sent", "booked", "completed"]),
          ),
        ),
      db
        .select({ value: count() })
        .from(appointments)
        .where(
          byClinic(
            appointments.clinicId,
            clinicId,
            notDeleted(appointments.deletedAt),
            and(
              inArray(appointments.status, ["scheduled", "confirmed"]),
              gte(appointments.scheduledAt, now),
            ),
          ),
        ),
      // "Recovered" = a recall that was sent AND the patient then had a completed
      // appointment on/after the reminder. Correlated EXISTS — the analytics case
      // where hand-written SQL on the same pool is clearest (db/index.ts policy).
      // Only run it when the Revenue feature is on.
      revenueEnabled
        ? db.execute(sql`
            SELECT count(DISTINCT r.id)::int AS recovered
            FROM recalls r
            WHERE r.clinic_id = ${clinicId}
              AND r.deleted_at IS NULL
              AND r.status IN ('sent', 'booked', 'completed')
              AND EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.patient_id = r.patient_id
                  AND a.clinic_id = r.clinic_id
                  AND a.deleted_at IS NULL
                  AND a.status = 'completed'
                  AND a.scheduled_at >= COALESCE(r.sent_at, r.due_at)
              )
          `)
        : Promise.resolve({ rows: [] as { recovered?: number }[] }),
    ]);

  const recovered = Number(
    (recoveredRes.rows[0] as { recovered?: number } | undefined)?.recovered ?? 0,
  );
  const revenueRecovered = recovered * avgVisitValue;
  const pkr = (n: number) =>
    new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
      maximumFractionDigits: 0,
    }).format(n);
  const money = pkr(revenueRecovered);

  // Collect the parallel sales summary (already running since it was created).
  const salesSummary = await salesSummaryPromise;

  // "Return visits" only means something alongside the Revenue metric, so it is
  // shown only when that feature is enabled.
  const stats = [
    ...(salesEnabled && salesSummary
      ? [
          {
            title: "Net sales (30 days)",
            value: pkr(salesSummary.netTotal),
            note: `${salesSummary.count} completed visit${salesSummary.count === 1 ? "" : "s"} · View report`,
            href: "/clinic/sales",
          },
        ]
      : []),
    ...(revenueEnabled
      ? [{ title: "Return visits", value: recovered, note: "From recall reminders" }]
      : []),
    { title: "Recalls sent", value: recallsSent.value, note: "Reminders delivered", href: "/clinic/recalls" },
    { title: "Upcoming appts", value: upcoming.value, note: "Scheduled ahead", href: "/clinic/appointments" },
    { title: "Patients", value: patientRows.value, note: "Registered", href: "/clinic/patients" },
    { title: "Staff", value: staff.value, note: CLINIC_STAFF_SUMMARY, href: "/clinic/staff" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your clinic at a glance.
        </p>
      </div>

      {/* Finance KPIs — Collected + Outstanding for billing clinics; Net profit +
          Payable when the finance feature is on. */}
      {financeKpis ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const fmt = (n: number) =>
              new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
            const loss = financeKpis.netProfit30d < 0;
            const kpis = [
              { show: billingKpiOn || financeKpiOn, title: "Collected (30d)", value: fmt(financeKpis.collected30d), note: "Revenue received", href: financeKpiOn ? "/clinic/pl" : "/clinic/sales" },
              { show: billingKpiOn, title: "Outstanding", value: fmt(financeKpis.outstandingReceivable), note: "Patients owe us", href: "/clinic/appointments?status=completed&payment=unpaid" },
              { show: financeKpiOn, title: loss ? "Net loss (30d)" : "Net profit (30d)", value: fmt(Math.abs(financeKpis.netProfit30d)), note: "After shares + expenses", href: "/clinic/pl", tone: loss ? "text-destructive" : "text-emerald-600 dark:text-emerald-400" },
              { show: financeKpiOn, title: "Payable to doctors", value: fmt(financeKpis.payableToDoctors), note: "Unpaid shares", href: "/clinic/shares" },
            ].filter((k) => k.show);
            return kpis.map((k) => (
              <Link key={k.title} href={k.href}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardHeader>
                    <CardDescription>{k.title}</CardDescription>
                    <CardTitle className={`text-3xl ${k.tone ?? ""}`}>{k.value}</CardTitle>
                    <CardDescription>{k.note}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ));
          })()}
        </div>
      ) : null}

      {/* Hero: Revenue Recovered — only when the super admin enabled it. */}
      {revenueEnabled ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardDescription>Revenue recovered</CardDescription>
            <CardTitle className="text-4xl text-primary">{money}</CardTitle>
            <CardDescription>
              {recovered} return visit{recovered === 1 ? "" : "s"} driven by
              recall reminders ×{" "}
              {new Intl.NumberFormat("en-PK").format(avgVisitValue)} PKR average
              visit value.
            </CardDescription>
          </CardHeader>
          {isAdmin ? (
            <CardContent>
              <AvgVisitValueForm value={avgVisitValue} />
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* Supporting stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => {
          const inner = (
            <Card className={s.href ? "transition-colors hover:border-primary/50" : ""}>
              <CardHeader>
                <CardDescription>{s.title}</CardDescription>
                <CardTitle className="text-3xl">{s.value}</CardTitle>
                <CardDescription>{s.note}</CardDescription>
              </CardHeader>
            </Card>
          );
          return s.href ? (
            <Link key={s.title} href={s.href}>
              {inner}
            </Link>
          ) : (
            <div key={s.title}>{inner}</div>
          );
        })}
      </div>

      {/* Doctor: manage your own leave / vacation (no separate nav page) — kept
          at the end of the dashboard. */}
      {isDoctor ? (
        <Card>
          <CardHeader>
            <CardTitle>My leave</CardTitle>
            <CardDescription>
              Add your leave / vacation days — appointments in the range are
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
