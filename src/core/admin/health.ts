import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { appointments, clinicPayments, clinics, patients } from "@/core/db/schema";
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
};

export type ClinicHealth = {
  rows: HealthRow[];
  /** Active/trial clinics with no activity for ≥ `inactiveDays` (or never) — churn risk. */
  atRisk: HealthRow[];
  inactiveDays: number;
};

const cashSum = sql<number>`coalesce(sum(case when ${clinicPayments.kind} = 'refund' then -${clinicPayments.amount} when ${clinicPayments.kind} = 'credit' then 0 else ${clinicPayments.amount} end),0)`;

export async function getClinicHealth(
  range: ResolvedRange,
  { assignedTo, inactiveDays = 21, withCost = true }: { assignedTo?: string; inactiveDays?: number; withCost?: boolean } = {},
): Promise<ClinicHealth> {
  const { start, end } = range;
  return unscoped("admin: clinic health", async () => {
    const scope = assignedTo ? eq(clinics.assignedTo, assignedTo) : undefined;

    const [clinicRows, serving, apptRows, patientRows, paidRows, lastRows] = await Promise.all([
      db.select({ id: clinics.id, name: clinics.name, status: clinics.status }).from(clinics).where(and(notDeleted(clinics.deletedAt), scope)),
      withCost ? computeServingCost(range) : Promise.resolve(null),
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
      // Global last activity per clinic — the most recent of a visit, appointment or
      // WhatsApp message (any time, not range-bound) → drives churn risk.
      db.execute(sql`
        select clinic_id, max(at) as last_at from (
          select clinic_id, created_at as at from visits where deleted_at is null
          union all
          select clinic_id, created_at as at from appointments where deleted_at is null
          union all
          select clinic_id, created_at as at from whatsapp_messages where clinic_id is not null
        ) a group by clinic_id
      `),
    ]);

    const servingByClinic = new Map((serving?.perClinic ?? []).map((c) => [c.clinicId, c]));
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
      };
    });

    // Churn risk: a LIVE (active/trial) clinic that's gone quiet — never active, or
    // no activity for ≥ inactiveDays. Most-stale first.
    const atRisk = rows
      .filter((r) => (r.status === "active" || r.status === "trial") && (r.daysInactive === null || r.daysInactive >= inactiveDays))
      .sort((a, b) => (b.daysInactive ?? 1e9) - (a.daysInactive ?? 1e9));

    rows.sort((a, b) => (b.daysInactive ?? 1e9) - (a.daysInactive ?? 1e9));
    return { rows, atRisk, inactiveDays };
  });
}
