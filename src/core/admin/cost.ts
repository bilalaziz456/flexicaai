import "server-only";

import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { clinics, platformCostRates, visits, whatsappMessages } from "@/core/db/schema";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Owner Finance — variable serving cost (Phase 1). Klenic's metered spend on the two
 * cost centres that scale with clinic activity: the AI scribe (Whisper + Claude, per
 * visit-with-audio) and WhatsApp (per outbound message). CORE, company-level (no
 * `clinic_id` scope — this is Klenic's own cost), so all reads run inside `unscoped`.
 *
 * v1 is a COUNT × UNIT-RATE ESTIMATE — there is no per-call token/minute log yet, so
 * scribe cost = (# visits with audio) × a configurable per-call rate, and WhatsApp
 * cost = (# outbound messages) × a per-message rate, both × the USD→PKR FX. Precise
 * metering is a later add. Rates come from the latest `platform_cost_rates` row.
 * See docs/owner-finance-plan.md §3-4.
 */

const n = (v: unknown): number => Number(v ?? 0);

export type CostRates = {
  scribeCallCost: number; // per scribe call, in `currency`
  whatsappMsgCost: number; // per outbound WhatsApp message, in `currency`
  currency: string; // e.g. "USD"
  usdToPkr: number; // FX to convert cost into the PKR the app shows
  effectiveFrom: Date | null; // null = never configured
};

const ZERO_RATES: CostRates = {
  scribeCallCost: 0,
  whatsappMsgCost: 0,
  currency: "USD",
  usdToPkr: 0,
  effectiveFrom: null,
};

/** The current (latest) unit-cost rates, or zeros when never configured. */
export async function getCostRates(): Promise<CostRates> {
  const [row] = await db
    .select()
    .from(platformCostRates)
    .orderBy(desc(platformCostRates.effectiveFrom))
    .limit(1);
  if (!row) return ZERO_RATES;
  return {
    scribeCallCost: n(row.scribeCallCost),
    whatsappMsgCost: n(row.whatsappMsgCost),
    currency: row.currency,
    usdToPkr: n(row.usdToPkr),
    effectiveFrom: row.effectiveFrom,
  };
}

/** Records a NEW rate version (history preserved; latest = current). */
export async function setCostRates(
  input: { scribeCallCost: number; whatsappMsgCost: number; usdToPkr: number; currency?: string },
  actor: { id: string; name: string },
): Promise<void> {
  await db.insert(platformCostRates).values({
    // numeric columns take string values in Drizzle.
    scribeCallCost: String(input.scribeCallCost),
    whatsappMsgCost: String(input.whatsappMsgCost),
    usdToPkr: String(input.usdToPkr),
    currency: input.currency ?? "USD",
    createdBy: actor.id,
    createdByName: actor.name,
  });
}

export type ClinicCost = {
  clinicId: string;
  name: string;
  scribeCalls: number;
  whatsappMsgs: number;
  costPkr: number;
};

/** One time bucket of the cost trend chart — scribe vs WhatsApp cost (PKR). */
export type CostBucket = {
  label: string;
  scribeCostPkr: number;
  whatsappCostPkr: number;
  costPkr: number;
};

export type ServingCost = {
  from: Date;
  to: Date;
  rates: CostRates;
  totalScribeCalls: number;
  totalWhatsappMsgs: number;
  totalCostPkr: number;
  perClinic: ClinicCost[];
  trend: CostBucket[];
};

/**
 * Estimated serving cost over a resolved range: scribe calls (visits with audio) +
 * outbound WhatsApp, priced at the CURRENT rates, split three ways — grand totals,
 * per clinic (for the table), and per time bucket (for the trend chart). One pass
 * over the range's rows keeps the per-clinic + per-bucket views consistent and in
 * LOCAL time (matching the sales report), avoiding DB-timezone bucket drift.
 * (v1 uses current rates for the whole window; historical per-period rate costing is
 * a later refinement.)
 */
export async function computeServingCost(range: ResolvedRange): Promise<ServingCost> {
  const { start, end, granularity } = range;
  return unscoped("admin: serving cost", async () => {
    const rates = await getCostRates();
    const scribeUnit = rates.scribeCallCost * rates.usdToPkr; // PKR per scribe call
    const waUnit = rates.whatsappMsgCost * rates.usdToPkr; // PKR per WhatsApp message

    // Scribe = visits WITH audio (Whisper+Claude ran). WhatsApp = OUTBOUND messages
    // (sends cost money; inbound is typically free). Fetch the minimal columns.
    const [scribeRows, waRows, clinicRows] = await Promise.all([
      db
        .select({ clinicId: visits.clinicId, at: visits.createdAt })
        .from(visits)
        .where(and(isNotNull(visits.audioKey), gte(visits.createdAt, start), lt(visits.createdAt, end))),
      db
        .select({ clinicId: whatsappMessages.clinicId, at: whatsappMessages.createdAt })
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.direction, "outbound"),
            isNotNull(whatsappMessages.clinicId),
            gte(whatsappMessages.createdAt, start),
            lt(whatsappMessages.createdAt, end),
          ),
        ),
      db.select({ id: clinics.id, name: clinics.name }).from(clinics).where(notDeleted(clinics.deletedAt)),
    ]);
    const nameOf = new Map(clinicRows.map((c) => [c.id, c.name]));

    // Pre-build every bucket in the range so the chart shows empty periods too.
    const buckets: CostBucket[] = [];
    const bucketIndex = new Map<number, number>();
    for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
      bucketIndex.set(cur.getTime(), buckets.length);
      buckets.push({ label: bucketLabel(cur, granularity), scribeCostPkr: 0, whatsappCostPkr: 0, costPkr: 0 });
    }
    const bucketFor = (at: Date): CostBucket | null => {
      const idx = bucketIndex.get(startOfBucket(at, granularity).getTime());
      return idx === undefined ? null : buckets[idx];
    };

    const byClinic = new Map<string, ClinicCost>();
    const clinicRow = (id: string | null): ClinicCost => {
      const key = id ?? "unattributed";
      let e = byClinic.get(key);
      if (!e) {
        e = { clinicId: key, name: id ? (nameOf.get(id) ?? "—") : "Unattributed", scribeCalls: 0, whatsappMsgs: 0, costPkr: 0 };
        byClinic.set(key, e);
      }
      return e;
    };

    let totalScribeCalls = 0;
    let totalWhatsappMsgs = 0;
    for (const r of scribeRows) {
      clinicRow(r.clinicId).scribeCalls += 1;
      totalScribeCalls += 1;
      const b = bucketFor(r.at);
      if (b) b.scribeCostPkr += scribeUnit;
    }
    for (const r of waRows) {
      clinicRow(r.clinicId).whatsappMsgs += 1;
      totalWhatsappMsgs += 1;
      const b = bucketFor(r.at);
      if (b) b.whatsappCostPkr += waUnit;
    }

    // Round per-clinic + per-bucket costs (rates applied, then rounded to PKR).
    let totalCostPkr = 0;
    for (const e of byClinic.values()) {
      e.costPkr = Math.round(e.scribeCalls * scribeUnit + e.whatsappMsgs * waUnit);
      totalCostPkr += e.costPkr;
    }
    for (const b of buckets) {
      b.scribeCostPkr = Math.round(b.scribeCostPkr);
      b.whatsappCostPkr = Math.round(b.whatsappCostPkr);
      b.costPkr = b.scribeCostPkr + b.whatsappCostPkr;
    }
    const perClinic = [...byClinic.values()].sort((a, b) => b.costPkr - a.costPkr);
    return { from: start, to: end, rates, totalScribeCalls, totalWhatsappMsgs, totalCostPkr, perClinic, trend: buckets };
  });
}
