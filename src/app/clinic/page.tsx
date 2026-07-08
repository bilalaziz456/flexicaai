import Link from "next/link";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import {
  appointments,
  clinics,
  patients,
  recalls,
  users,
} from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AvgVisitValueForm } from "./avg-visit-value-form";

/**
 * Owner dashboard (CLAUDE.md §11 Step 12). The hero metric is "Revenue
 * Recovered": recall reminders that brought patients back = return visits ×
 * the owner's average visit value. Everything is clinic-scoped.
 */
export default async function ClinicDashboard() {
  const { clinicId } = await requireClinicAdmin();
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
  const avgVisitValue = clinicRow?.avgVisitValue ?? 3000;

  const [[staff], [patientRows], [recallsSent], [upcoming], recoveredRes] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(users)
        .where(
          and(
            eq(users.clinicId, clinicId),
            inArray(users.role, ["doctor", "receptionist"]),
          ),
        ),
      db
        .select({ value: count() })
        .from(patients)
        .where(byClinic(patients.clinicId, clinicId)),
      db
        .select({ value: count() })
        .from(recalls)
        .where(
          byClinic(
            recalls.clinicId,
            clinicId,
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
              AND r.status IN ('sent', 'booked', 'completed')
              AND EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.patient_id = r.patient_id
                  AND a.clinic_id = r.clinic_id
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
  const money = new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(revenueRecovered);

  // "Return visits" only means something alongside the Revenue metric, so it is
  // shown only when that feature is enabled.
  const stats = [
    ...(revenueEnabled
      ? [{ title: "Return visits", value: recovered, note: "From recall reminders" }]
      : []),
    { title: "Recalls sent", value: recallsSent.value, note: "Reminders delivered", href: "/clinic/recalls" },
    { title: "Upcoming appts", value: upcoming.value, note: "Scheduled ahead", href: "/clinic/appointments" },
    { title: "Patients", value: patientRows.value, note: "Registered", href: "/clinic/patients" },
    { title: "Staff", value: staff.value, note: "Doctors & reception", href: "/clinic/staff" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your clinic at a glance.
        </p>
      </div>

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
          <CardContent>
            <AvgVisitValueForm value={avgVisitValue} />
          </CardContent>
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
    </div>
  );
}
