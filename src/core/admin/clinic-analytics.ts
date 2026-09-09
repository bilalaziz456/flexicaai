import "server-only";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import {
  appointments,
  cities,
  clinicPayments,
  clinics,
  patientPayments,
  patients,
  users,
  visits,
  whatsappMessages,
} from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { getOutstandingTotal } from "@/core/finance/receivables";
import { paymentKindId, userRoleId } from "@/core/db/vocabulary-seed";
import { computeClinicBalance, type ClinicBalance } from "@/core/admin/billing";
import {
  computePaymentBehaviour,
  computeTrend,
  ratingWindows,
  type BehaviourTrend,
  type PaymentBehaviour,
  type RatingWindow,
} from "@/core/admin/payment-behaviour";

/**
 * Everything the super admin's "Clinic analytics" card shows about ONE clinic.
 *
 * Two questions in one place, deliberately, because they are the two halves of the
 * same judgement:
 *   A — does this clinic pay US reliably?      (`behaviour`, `balance`)
 *   B — is this clinic's own business alive?   (`business`)
 * A clinic that pays late because it is dying needs a different conversation from one
 * that pays late out of habit while booking more patients every month, and neither
 * half tells you which you are looking at.
 *
 * CROSS-TENANT by definition — the company reading one of its customers — so the reads
 * are `unscoped` with a reason rather than silently tripping the tenant guard.
 */

export type BusinessSnapshot = {
  /** Live patients on the books, and how many arrived in the window. */
  patientsTotal: number;
  patientsNew: number;
  appointments: number;
  completed: number;
  cancelled: number;
  noShows: number;
  /** Of appointments that have reached a settled outcome. Null when there are none. */
  noShowRate: number | null;
  visits: number;
  scribeRuns: number;
  whatsappOut: number;
  whatsappIn: number;
  staffActive: number;
  doctors: number;
  /** Money the CLINIC took from its patients in the window (net of refunds). */
  collected: number;
  /** What its patients still owe it — the clinic's own receivable, not ours. */
  outstanding: number;
  lastActivityAt: Date | null;
};

export type ClinicAnalytics = {
  clinic: {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    activatedAt: Date | null;
    monthlyPrice: number;
    billingCycle: string;
    city: string | null;
    province: string | null;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
  };
  balance: ClinicBalance;
  behaviour: PaymentBehaviour;
  trend: BehaviourTrend;
  windows: RatingWindow[];
  business: BusinessSnapshot;
  /** The window `business` covers. */
  range: { from: Date; to: Date; label: string };
};

const SETTLED = ["completed", "cancelled", "no_show"] as const;

/**
 * @param months  How far back the BUSINESS half looks. `null` is the clinic's whole
 *                life. The payment half is always all-time — it is re-scoped in the
 *                browser from months already on the client, so it needs no window here.
 */
export async function getClinicAnalytics(
  clinicId: string,
  { months = 3, now = new Date() }: { months?: number | null; now?: Date } = {},
): Promise<ClinicAnalytics | null> {
  return unscoped("admin: analytics for one clinic", async () => {
    const [row] = await db
      .select({
        id: clinics.id,
        name: clinics.name,
        status: clinics.status,
        createdAt: clinics.createdAt,
        activatedAt: clinics.activatedAt,
        monthlyPrice: clinics.monthlyPrice,
        billingCycle: clinics.billingCycle,
        graceDays: clinics.graceDays,
        province: clinics.province,
        city: cities.name,
        ownerName: clinics.ownerName,
        ownerPhone: clinics.ownerPhone,
        ownerEmail: clinics.ownerEmail,
      })
      .from(clinics)
      .leftJoin(cities, eq(cities.id, clinics.cityId))
      .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
      .limit(1);
    if (!row) return null;

    // "All time" for the business half means since the clinic existed, not since some
    // arbitrary cutoff — a clinic three years old should not have its first two years
    // silently excluded from a window labelled "all time".
    const from =
      months === null
        ? (row.activatedAt ?? row.createdAt)
        : (() => {
            const d = new Date(now);
            d.setMonth(d.getMonth() - months);
            return d;
          })();

    // ── A: what they have paid us, oldest first ──────────────────────────────
    const ledger = await db
      .select({
        amount: clinicPayments.amount,
        kind: clinicPayments.kind,
        occurredAt: clinicPayments.occurredAt,
      })
      .from(clinicPayments)
      .where(and(eq(clinicPayments.clinicId, clinicId), notDeleted(clinicPayments.deletedAt)))
      .orderBy(clinicPayments.occurredAt);

    const balance = computeClinicBalance(
      {
        monthlyPrice: row.monthlyPrice,
        graceDays: row.graceDays,
        activatedAt: row.activatedAt,
        createdAt: row.createdAt,
      },
      ledger,
      now,
    );
    const behaviour = computePaymentBehaviour(row, ledger, now);
    const trend = computeTrend(behaviour.months);
    const windows = ratingWindows(behaviour.months);

    // ── B: their own business over the window ────────────────────────────────
    // One statement per shape rather than per metric: the appointment mix is a single
    // grouped scan, not four counting queries over the same rows.
    const inWindow = and(gte(appointments.scheduledAt, from), lt(appointments.scheduledAt, now));

    const [
      patientsTotalRow,
      patientsNewRow,
      apptMix,
      visitRows,
      waRows,
      staffRow,
      collectedRow,
      outstandingRow,
      lastApptRow,
    ] = await Promise.all([
      db
        .select({ n: count() })
        .from(patients)
        .where(and(eq(patients.clinicId, clinicId), notDeleted(patients.deletedAt))),
      db
        .select({ n: count() })
        .from(patients)
        .where(
          and(
            eq(patients.clinicId, clinicId),
            notDeleted(patients.deletedAt),
            gte(patients.createdAt, from),
          ),
        ),
      db
        .select({ status: appointments.status, n: count() })
        .from(appointments)
        .where(and(eq(appointments.clinicId, clinicId), notDeleted(appointments.deletedAt), inWindow))
        .groupBy(appointments.status),
      db
        .select({
          n: count(),
          scribe: sql<number>`count(*) filter (where ${visits.audioKey} is not null)`,
        })
        .from(visits)
        .where(
          and(
            eq(visits.clinicId, clinicId),
            notDeleted(visits.deletedAt),
            gte(visits.createdAt, from),
          ),
        ),
      db
        .select({ direction: whatsappMessages.direction, n: count() })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.clinicId, clinicId), gte(whatsappMessages.createdAt, from)))
        .groupBy(whatsappMessages.direction),
      db
        .select({
          n: count(),
          doctors: sql<number>`count(*) filter (where ${users.role} = ${userRoleId("doctor")})`,
        })
        .from(users)
        .where(
          and(eq(users.clinicId, clinicId), notDeleted(users.deletedAt), eq(users.isActive, true)),
        ),
      db
        .select({
          total: sql<number>`coalesce(sum(case when ${patientPayments.kind} = ${paymentKindId("refund")} then -${patientPayments.amount} else ${patientPayments.amount} end), 0)::int`,
        })
        .from(patientPayments)
        .where(
          and(
            eq(patientPayments.clinicId, clinicId),
            notDeleted(patientPayments.deletedAt),
            gte(patientPayments.occurredAt, from),
          ),
        ),
      getOutstandingTotal(clinicId),
      db
        .select({ at: appointments.createdAt })
        .from(appointments)
        .where(and(eq(appointments.clinicId, clinicId), notDeleted(appointments.deletedAt)))
        .orderBy(desc(appointments.createdAt))
        .limit(1),
    ]);

    const mix = new Map(apptMix.map((r) => [r.status as string, r.n]));
    const appointmentsTotal = apptMix.reduce((s, r) => s + r.n, 0);
    const settled = SETTLED.reduce((s, k) => s + (mix.get(k) ?? 0), 0);
    const noShows = mix.get("no_show") ?? 0;
    const wa = new Map(waRows.map((r) => [r.direction as string, r.n]));

    const business: BusinessSnapshot = {
      patientsTotal: patientsTotalRow[0]?.n ?? 0,
      patientsNew: patientsNewRow[0]?.n ?? 0,
      appointments: appointmentsTotal,
      completed: mix.get("completed") ?? 0,
      cancelled: mix.get("cancelled") ?? 0,
      noShows,
      // Only over appointments that actually reached an outcome — counting future
      // bookings in the denominator would make a busy clinic look reliable purely
      // for having a full diary next month.
      noShowRate: settled > 0 ? noShows / settled : null,
      visits: visitRows[0]?.n ?? 0,
      scribeRuns: Number(visitRows[0]?.scribe ?? 0),
      whatsappOut: wa.get("outbound") ?? 0,
      whatsappIn: wa.get("inbound") ?? 0,
      staffActive: staffRow[0]?.n ?? 0,
      doctors: Number(staffRow[0]?.doctors ?? 0),
      collected: Number(collectedRow[0]?.total ?? 0),
      outstanding: outstandingRow,
      lastActivityAt: lastApptRow[0]?.at ?? null,
    };

    return {
      clinic: {
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        activatedAt: row.activatedAt,
        monthlyPrice: row.monthlyPrice,
        billingCycle: row.billingCycle,
        city: row.city,
        province: row.province,
        ownerName: row.ownerName,
        ownerPhone: row.ownerPhone,
        ownerEmail: row.ownerEmail,
      },
      balance,
      behaviour,
      trend,
      windows,
      business,
      range: {
        from,
        to: now,
        label: months === null ? "all time" : `last ${months} months`,
      },
    };
  });
}
