import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, sales, saleShares } from "@/core/db/schema";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
  type SalesBucket,
  type SalesGranularity,
} from "@/core/sales/report";

export type DoctorShareRow = {
  doctorId: string | null;
  name: string;
  earned: number; // earned in the filtered period
  count: number; // earning visits in the period
};

export type SharesReport = {
  granularity: SalesGranularity;
  /** Σ doctor shares earned in the filtered period. */
  shareTotal: number;
  /** # earning share rows in the period. */
  count: number;
  avgShare: number;
  /** Clinic's own cut (net − all doctor shares) — only in the full, unfiltered
   *  view (null when scoped to one doctor / a doctor's self-view). */
  clinicTotal: number | null;
  /** Σ realised net over the range (full, unfiltered view only). */
  netTotal: number | null;
  buckets: SalesBucket[];
  byDoctor: DoctorShareRow[];
};

/**
 * The revenue-SHARE report for a clinic over a range — per-doctor earned shares +
 * (in the full view) the clinic's derived cut and a share-over-time chart. CORE +
 * clinic-scoped. Reads the `sale_shares` ledger (one row per doctor per completed
 * appointment); the clinic cut is net (`sales`) − Σ doctor shares.
 *
 * `doctorId` scopes to a single doctor (a doctor's self-view passes their own id).
 * When scoped, the clinic/net totals are omitted (they only make sense clinic-wide).
 */
export async function getSharesReport(
  clinicId: string,
  range: ResolvedRange,
  doctorId?: string | null,
): Promise<SharesReport> {
  const { start, end, granularity } = range;
  const scoped = Boolean(doctorId);

  const rows = await db
    .select({
      doctorId: saleShares.doctorId,
      doctorName: saleShares.doctorName,
      shareAmount: saleShares.shareAmount,
      occurredAt: saleShares.occurredAt,
    })
    .from(saleShares)
    .where(
      byClinic(
        saleShares.clinicId,
        clinicId,
        and(
          gte(saleShares.occurredAt, start),
          lt(saleShares.occurredAt, end),
          doctorId ? eq(saleShares.doctorId, doctorId) : undefined,
        ),
      ),
    )
    .orderBy(asc(saleShares.occurredAt));

  // Pre-build every bucket so the chart shows empty periods too.
  const buckets: { t: number; label: string; value: number }[] = [];
  const bucketIndex = new Map<number, number>();
  for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
    bucketIndex.set(cur.getTime(), buckets.length);
    buckets.push({ t: cur.getTime(), label: bucketLabel(cur, granularity), value: 0 });
  }

  let shareTotal = 0;
  const doctorMap = new Map<string, DoctorShareRow>();
  for (const r of rows) {
    shareTotal += r.shareAmount;
    const bi = bucketIndex.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (bi !== undefined) buckets[bi].value += r.shareAmount;

    const key = r.doctorId ?? "__none__";
    const existing = doctorMap.get(key);
    if (existing) {
      existing.earned += r.shareAmount;
      existing.count += 1;
    } else {
      doctorMap.set(key, {
        doctorId: r.doctorId,
        name: r.doctorName ?? "Unknown",
        earned: r.shareAmount,
        count: 1,
      });
    }
  }
  const byDoctor = [...doctorMap.values()].sort((a, b) => b.earned - a.earned);

  // The clinic's cut = realised net − all doctor shares (whole-clinic view only).
  let clinicTotal: number | null = null;
  let netTotal: number | null = null;
  if (!scoped) {
    const [net] = await db
      .select({ net: sql<number>`coalesce(sum(${sales.netAmount}), 0)::int` })
      .from(sales)
      .where(
        byClinic(
          sales.clinicId,
          clinicId,
          and(gte(sales.occurredAt, start), lt(sales.occurredAt, end)),
        ),
      );
    netTotal = Number(net?.net ?? 0);
    clinicTotal = Math.max(0, netTotal - shareTotal);
  }

  const count = rows.length;
  return {
    granularity,
    shareTotal,
    count,
    avgShare: count > 0 ? Math.round(shareTotal / count) : 0,
    clinicTotal,
    netTotal,
    buckets: buckets.map((b) => ({ label: b.label, value: b.value })),
    byDoctor,
  };
}

/** One earning line on a doctor's statement — the visit and their share of it. */
export type ShareLine = {
  occurredAt: Date;
  patientName: string | null;
  amount: number;
};

/**
 * A doctor's earning lines (one per completed visit they shared in), newest first,
 * for the printable statement. Clinic-scoped; capped so a statement stays bounded.
 */
export async function listDoctorEarnings(
  clinicId: string,
  doctorId: string,
  limit = 1000,
): Promise<ShareLine[]> {
  const rows = await db
    .select({
      occurredAt: saleShares.occurredAt,
      amount: saleShares.shareAmount,
      patientName: patients.fullName,
    })
    .from(saleShares)
    .leftJoin(appointments, eq(appointments.id, saleShares.appointmentId))
    .leftJoin(patients, eq(patients.id, appointments.patientId))
    .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.doctorId, doctorId)))
    .orderBy(desc(saleShares.occurredAt))
    .limit(limit);
  return rows.map((r) => ({
    occurredAt: r.occurredAt,
    patientName: r.patientName,
    amount: r.amount,
  }));
}
