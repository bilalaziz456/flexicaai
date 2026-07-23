import "server-only";

import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { appointments, clinicPayments, clinics, patients, users } from "@/core/db/schema";
import { computeServingCost } from "@/core/admin/cost";
import type { ResolvedRange } from "@/core/sales/report";

/**
 * Clinic health / engagement (Owner Overview) — the operational counterpart to the
 * financial metrics: how ACTIVELY each clinic uses the product, when it was last
 * active (churn risk), and its usage cost + margin. CORE, cross-tenant → `unscoped`.
 * Reuses `computeServingCost` for the per-clinic serving cost + scribe/WhatsApp
 * usage, and adds appointments, new patients, collected, and a global last-activity
 * signal. Scoped to a manager's clinics when `assignedTo` is set.
 */

const MS_DAY = 86_400_000;
const num = (v: unknown): number => Number(v ?? 0);

export type HealthRow = {
  clinicId: string;
  name: string;
  status: string;
  lastActivityAt: Date | null;
  daysInactive: number | null; // null = never active
  appointments: number;
  scribeCalls: number;
  whatsappOut: number;
  patientsNew: number;
  servingCost: number;
  collected: number;
  margin: number; // collected − serving cost
  // Actionable clinic data — who to contact about an at-risk clinic.
  mrr: number; // monthly_price
  ownerPhone: string | null;
  ownerEmail: string | null;
  assigneeName: string | null; // account manager
  /** Usage/cost anomaly flags (only when `withCost`). See ANOMALY_META. */
  flags: AnomalyFlag[];
};

/** Usage/cost anomalies surfaced on the Overview so outliers raise their hand. */
export type AnomalyFlag = "loss" | "thin_margin" | "usage_spike";
export const ANOMALY_META: Record<AnomalyFlag, { label: string; severity: "high" | "warn"; hint: string }> = {
  loss: { label: "Cost > MRR", severity: "high", hint: "Serving cost exceeds the monthly price — losing money on this clinic." },
  thin_margin: { label: "High cost", severity: "warn", hint: "Serving cost is ≥ 50% of the monthly price — thin margin." },
  usage_spike: { label: "Usage spike", severity: "warn", hint: "Serving cost is ≥ 3× the previous period — runaway usage, abuse, or an upsell." },
};

// Anomaly thresholds (v1, fixed).
const THIN_MARGIN_RATIO = 0.5; // serving cost ≥ 50% of MRR
const SPIKE_MULTIPLE = 3; // this period ≥ 3× the prior period
const SPIKE_FLOOR_PKR = 200; // ignore tiny absolute costs (0→30 isn't a "spike")

export type ClinicHealth = {
  rows: HealthRow[];
  /** Active/trial clinics with no activity for ≥ `inactiveDays` (or never) — churn risk. */
  atRisk: HealthRow[];
  /** Clinics with any usage/cost anomaly flag, worst (loss) first. */
  flagged: HealthRow[];
  inactiveDays: number;
};

const cashSum = sql<number>`coalesce(sum(case when ${clinicPayments.kind} = 'refund' then -${clinicPayments.amount} when ${clinicPayments.kind} = 'credit' then 0 else ${clinicPayments.amount} end),0)`;

export async function getClinicHealth(
  range: ResolvedRange,
  { assignedTo, inactiveDays = 21, withCost = true }: { assignedTo?: string; inactiveDays?: number; withCost?: boolean } = {},
): Promise<ClinicHealth> {
  const { start, end } = range;
  // Prior equal-length window (immediately before this one) — the spike baseline.
  const priorRange: ResolvedRange = { ...range, start: new Date(start.getTime() - (end.getTime() - start.getTime())), end: start };
  return unscoped("admin: clinic health", async () => {
    const scope = assignedTo ? eq(clinics.assignedTo, assignedTo) : undefined;

    const [clinicRows, serving, priorServing, apptRows, patientRows, paidRows, lastRows] = await Promise.all([
      db
        .select({
          id: clinics.id,
          name: clinics.name,
          status: clinics.status,
          mrr: clinics.monthlyPrice,
          ownerPhone: clinics.ownerPhone,
          ownerEmail: clinics.ownerEmail,
          assigneeFullName: users.fullName,
          assigneeUsername: users.username,
        })
        .from(clinics)
        .leftJoin(users, and(eq(clinics.assignedTo, users.id), isNull(users.deletedAt)))
        .where(and(notDeleted(clinics.deletedAt), scope)),
      withCost ? computeServingCost(range) : Promise.resolve(null),
      withCost ? computeServingCost(priorRange) : Promise.resolve(null),
      db
        .select({ clinicId: appointments.clinicId, c: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(notDeleted(appointments.deletedAt), gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, end)))
        .groupBy(appointments.clinicId),
      db
        .select({ clinicId: patients.clinicId, c: sql<number>`count(*)::int` })
        .from(patients)
        .where(and(notDeleted(patients.deletedAt), gte(patients.createdAt, start), lt(patients.createdAt, end)))
        .groupBy(patients.clinicId),
      db
        .select({ clinicId: clinicPayments.clinicId, t: cashSum })
        .from(clinicPayments)
        .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, start), lt(clinicPayments.occurredAt, end)))
        .groupBy(clinicPayments.clinicId),
      // Global last activity per clinic — the most recent of a visit, appointment,
      // WhatsApp message, or STAFF LOGIN (any time, not range-bound) → churn risk.
      db.execute(sql`
        select clinic_id, max(at) as last_at from (
          select clinic_id, created_at as at from visits where deleted_at is null
          union all
          select clinic_id, created_at as at from appointments where deleted_at is null
          union all
          select clinic_id, created_at as at from whatsapp_messages where clinic_id is not null
          union all
          select clinic_id, created_at as at from activity_logs where action = 'login' and clinic_id is not null
        ) a group by clinic_id
      `),
    ]);

    const servingByClinic = new Map((serving?.perClinic ?? []).map((c) => [c.clinicId, c]));
    const priorCostByClinic = new Map((priorServing?.perClinic ?? []).map((c) => [c.clinicId, c.costPkr]));
    const apptBy = new Map(apptRows.map((r) => [r.clinicId, num(r.c)]));
    const patientBy = new Map(patientRows.map((r) => [r.clinicId, num(r.c)]));
    const paidBy = new Map(paidRows.map((r) => [r.clinicId, num(r.t)]));
    const lastBy = new Map<string, Date>();
    for (const r of lastRows.rows as { clinic_id: string; last_at: string | Date | null }[]) {
      if (r.clinic_id && r.last_at) lastBy.set(r.clinic_id, new Date(r.last_at));
    }

    const now = Date.now();
    const rows: HealthRow[] = clinicRows.map((c) => {
      const sc = servingByClinic.get(c.id);
      const lastActivityAt = lastBy.get(c.id) ?? null;
      const daysInactive = lastActivityAt ? Math.floor((now - lastActivityAt.getTime()) / MS_DAY) : null;
      const servingCost = sc?.costPkr ?? 0;
      const collected = paidBy.get(c.id) ?? 0;
      const mrr = num(c.mrr);

      // Usage/cost anomaly flags (cost side → only when metering is in view).
      const flags: AnomalyFlag[] = [];
      if (withCost && servingCost > 0) {
        if (mrr > 0 && servingCost > mrr) flags.push("loss");
        else if (mrr > 0 && servingCost >= THIN_MARGIN_RATIO * mrr) flags.push("thin_margin");
        const prior = priorCostByClinic.get(c.id) ?? 0;
        if (servingCost >= SPIKE_FLOOR_PKR && prior > 0 && servingCost >= SPIKE_MULTIPLE * prior) flags.push("usage_spike");
      }

      return {
        clinicId: c.id,
        name: c.name,
        status: c.status,
        lastActivityAt,
        daysInactive,
        appointments: apptBy.get(c.id) ?? 0,
        scribeCalls: sc?.scribeCalls ?? 0,
        whatsappOut: sc?.whatsappMsgs ?? 0,
        patientsNew: patientBy.get(c.id) ?? 0,
        servingCost,
        collected,
        margin: collected - servingCost,
        mrr,
        ownerPhone: c.ownerPhone,
        ownerEmail: c.ownerEmail,
        assigneeName: c.assigneeFullName ?? c.assigneeUsername ?? null,
        flags,
      };
    });

    // Churn risk: a LIVE (active/trial) clinic that's gone quiet — never active, or
    // no activity for ≥ inactiveDays. Most-stale first.
    const atRisk = rows
      .filter((r) => (r.status === "active" || r.status === "trial") && (r.daysInactive === null || r.daysInactive >= inactiveDays))
      .sort((a, b) => (b.daysInactive ?? 1e9) - (a.daysInactive ?? 1e9));

    // Usage/cost anomalies — a loss (high severity) sorts above warnings, then by
    // how far serving cost overshoots the monthly price.
    const flagged = rows
      .filter((r) => r.flags.length > 0)
      .sort((a, b) => {
        const sev = (r: HealthRow) => (r.flags.includes("loss") ? 2 : 1);
        return sev(b) - sev(a) || (b.servingCost - b.mrr) - (a.servingCost - a.mrr);
      });

    rows.sort((a, b) => (b.daysInactive ?? 1e9) - (a.daysInactive ?? 1e9));
    return { rows, atRisk, flagged, inactiveDays };
  });
}
