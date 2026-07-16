import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, discountSettlements, doctorPayouts, patients, sales, saleShares } from "@/core/db/schema";
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

/** Earned + Paid in one time bucket (for the Earned-vs-Paid charts). */
export type ShareTimePoint = { label: string; earned: number; paid: number };

export type SharesReport = {
  granularity: SalesGranularity;
  /** Σ doctor shares earned in the filtered period. */
  shareTotal: number;
  /** Σ payouts recorded in the filtered period (by payment date). */
  paidTotal: number;
  /** # earning share rows in the period. */
  count: number;
  avgShare: number;
  /** Clinic's own cut (net − all doctor shares) — only in the full, unfiltered
   *  view (null when scoped to one doctor / a doctor's self-view). */
  clinicTotal: number | null;
  /** Σ realised net over the range (full, unfiltered view only). */
  netTotal: number | null;
  buckets: SalesBucket[]; // earned-only (kept for back-compat)
  /** Earned + Paid per bucket (grouped bars). Paid is dated by payment date. */
  activityBuckets: ShareTimePoint[];
  /** Running cumulative Earned + Paid, seeded with balances before the range, so
   *  the vertical gap at any point = the true outstanding at that time. */
  cumulativeBuckets: ShareTimePoint[];
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

  // Discount settlements (doctor rows) in the range — folded into "earned" so a
  // doctor's earnings reflect what they bear (a doctor-borne discount lowers it).
  const settleRows = await db
    .select({
      doctorId: discountSettlements.doctorId,
      doctorName: discountSettlements.doctorName,
      shareAmount: discountSettlements.settlementAmount,
      occurredAt: discountSettlements.occurredAt,
    })
    .from(discountSettlements)
    .where(
      byClinic(
        discountSettlements.clinicId,
        clinicId,
        and(
          eq(discountSettlements.party, "doctor"),
          gte(discountSettlements.occurredAt, start),
          lt(discountSettlements.occurredAt, end),
          doctorId ? eq(discountSettlements.doctorId, doctorId) : undefined,
        ),
      ),
    );

  // Payouts in the range (by payment date) + opening balances before the range,
  // so the cumulative lines start from the true outstanding, not zero.
  const [payoutRows, [openEarnedRow], [openBorneRow], [openPaidRow]] = await Promise.all([
    db
      .select({ amount: doctorPayouts.amount, createdAt: doctorPayouts.createdAt })
      .from(doctorPayouts)
      .where(
        byClinic(
          doctorPayouts.clinicId,
          clinicId,
          and(
            gte(doctorPayouts.createdAt, start),
            lt(doctorPayouts.createdAt, end),
            doctorId ? eq(doctorPayouts.doctorId, doctorId) : undefined,
          ),
        ),
      ),
    db
      .select({ v: sql<number>`coalesce(sum(${saleShares.shareAmount}), 0)::int` })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, and(lt(saleShares.occurredAt, start), doctorId ? eq(saleShares.doctorId, doctorId) : undefined))),
    db
      .select({ v: sql<number>`coalesce(sum(${discountSettlements.settlementAmount}), 0)::int` })
      .from(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, and(eq(discountSettlements.party, "doctor"), lt(discountSettlements.occurredAt, start), doctorId ? eq(discountSettlements.doctorId, doctorId) : undefined))),
    db
      .select({ v: sql<number>`coalesce(sum(${doctorPayouts.amount}), 0)::int` })
      .from(doctorPayouts)
      .where(byClinic(doctorPayouts.clinicId, clinicId, and(lt(doctorPayouts.createdAt, start), doctorId ? eq(doctorPayouts.doctorId, doctorId) : undefined))),
  ]);

  // Pre-build every bucket so the chart shows empty periods too.
  const buckets: { t: number; label: string; earned: number; paid: number }[] = [];
  const bucketIndex = new Map<number, number>();
  for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
    bucketIndex.set(cur.getTime(), buckets.length);
    buckets.push({ t: cur.getTime(), label: bucketLabel(cur, granularity), earned: 0, paid: 0 });
  }

  let shareTotal = 0;
  const doctorMap = new Map<string, DoctorShareRow>();
  for (const r of rows) {
    shareTotal += r.shareAmount;
    const bi = bucketIndex.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (bi !== undefined) buckets[bi].earned += r.shareAmount;

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
  // Fold the discount settlements into "earned" (same occurredAt bucketing as shares;
  // a settlement-only visit — doctor-borne with nothing collected — still shows up).
  for (const r of settleRows) {
    shareTotal += r.shareAmount;
    const bi = bucketIndex.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (bi !== undefined) buckets[bi].earned += r.shareAmount;
    const key = r.doctorId ?? "__none__";
    const existing = doctorMap.get(key);
    if (existing) existing.earned += r.shareAmount;
    else doctorMap.set(key, { doctorId: r.doctorId, name: r.doctorName ?? "Unknown", earned: r.shareAmount, count: 0 });
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
    // Clinic cut = realised net − doctor NET earnings (shares + settlements). May be
    // negative when the clinic bears discounts (it pays doctors from its cut).
    clinicTotal = netTotal - shareTotal;
  }

  // Paid per bucket (by payment date).
  let paidTotal = 0;
  for (const p of payoutRows) {
    paidTotal += p.amount;
    const bi = bucketIndex.get(startOfBucket(p.createdAt, granularity).getTime());
    if (bi !== undefined) buckets[bi].paid += p.amount;
  }

  // Cumulative lines seeded with the balances before the range → gap = outstanding.
  // Opening "earned" includes prior settlements so the gap reflects the true balance.
  let cumE = Number(openEarnedRow?.v ?? 0) + Number(openBorneRow?.v ?? 0);
  let cumP = Number(openPaidRow?.v ?? 0);
  const cumulativeBuckets: ShareTimePoint[] = buckets.map((b) => {
    cumE += b.earned;
    cumP += b.paid;
    return { label: b.label, earned: cumE, paid: cumP };
  });

  const count = rows.length + settleRows.length;
  return {
    granularity,
    shareTotal,
    paidTotal,
    count,
    avgShare: count > 0 ? Math.round(shareTotal / count) : 0,
    clinicTotal,
    netTotal,
    buckets: buckets.map((b) => ({ label: b.label, value: b.earned })),
    activityBuckets: buckets.map((b) => ({ label: b.label, earned: b.earned, paid: b.paid })),
    cumulativeBuckets,
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
