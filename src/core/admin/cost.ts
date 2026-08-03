import "server-only";

import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { aiUsage, clinics, platformCostRates, visits, whatsappMessages } from "@/core/db/schema";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";
import { taxMultiplier as computeTaxMultiplier } from "./cost-tax";

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
  scribeCallCost: number; // ESTIMATE: per scribe call (fallback), in `currency`
  whatsappMsgCost: number; // per outbound WhatsApp message, in `currency`
  whisperMinuteCost: number; // METERED: Whisper per audio minute, in `currency`
  claudeInputCost: number; // METERED: Claude per 1M input tokens, in `currency`
  claudeOutputCost: number; // METERED: Claude per 1M output tokens, in `currency`
  currency: string; // e.g. "USD"
  usdToPkr: number; // FX to convert cost into the PKR the app shows
  // International-transaction tax/charges the bank adds on the USD payment. Either
  // ITEMISED (fee + FED + advance + additional, summed) or a single TOTAL %. All in
  // percent; 0 = no markup. See `effectiveTaxPct`.
  taxMode: "itemized" | "total";
  foreignTxnFeePct: number;
  fedPct: number;
  advanceTaxPct: number;
  additionalTaxPct: number;
  totalTaxPct: number;
  effectiveFrom: Date | null; // null = never configured
};

const ZERO_RATES: CostRates = {
  scribeCallCost: 0,
  whatsappMsgCost: 0,
  whisperMinuteCost: 0,
  claudeInputCost: 0,
  claudeOutputCost: 0,
  currency: "USD",
  usdToPkr: 0,
  taxMode: "itemized",
  foreignTxnFeePct: 0,
  fedPct: 0,
  advanceTaxPct: 0,
  additionalTaxPct: 0,
  totalTaxPct: 0,
  effectiveFrom: null,
};

// The bank-tax math lives in a client-safe module (this file is server-only) so the rate
// form's live preview and the serving-cost calc share one formula. Re-exported here so
// server callers keep a single import site.
export { effectiveTaxPct, taxMultiplier, FILER_TAX_DEFAULTS } from "./cost-tax";

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
    whisperMinuteCost: n(row.whisperMinuteCost),
    claudeInputCost: n(row.claudeInputCost),
    claudeOutputCost: n(row.claudeOutputCost),
    currency: row.currency,
    usdToPkr: n(row.usdToPkr),
    taxMode: row.taxMode === "total" ? "total" : "itemized",
    foreignTxnFeePct: n(row.foreignTxnFeePct),
    fedPct: n(row.fedPct),
    advanceTaxPct: n(row.advanceTaxPct),
    additionalTaxPct: n(row.additionalTaxPct),
    totalTaxPct: n(row.totalTaxPct),
    effectiveFrom: row.effectiveFrom,
  };
}

/** USD cost of one metered scribe run (Whisper minutes + Claude tokens). PURE. */
export function scribeUsageCostUsd(
  usage: { audioSeconds: number; inputTokens: number; outputTokens: number },
  rates: CostRates,
): number {
  return (
    (usage.audioSeconds / 60) * rates.whisperMinuteCost +
    (usage.inputTokens / 1_000_000) * rates.claudeInputCost +
    (usage.outputTokens / 1_000_000) * rates.claudeOutputCost
  );
}

/** Records a NEW rate version (history preserved; latest = current). */
export async function setCostRates(
  input: {
    scribeCallCost: number;
    whatsappMsgCost: number;
    usdToPkr: number;
    whisperMinuteCost?: number;
    claudeInputCost?: number;
    claudeOutputCost?: number;
    currency?: string;
    taxMode?: "itemized" | "total";
    foreignTxnFeePct?: number;
    fedPct?: number;
    advanceTaxPct?: number;
    additionalTaxPct?: number;
    totalTaxPct?: number;
  },
  actor: { id: string; name: string },
): Promise<void> {
  await db.insert(platformCostRates).values({
    // numeric columns take string values in Drizzle.
    scribeCallCost: String(input.scribeCallCost),
    whatsappMsgCost: String(input.whatsappMsgCost),
    whisperMinuteCost: String(input.whisperMinuteCost ?? 0),
    claudeInputCost: String(input.claudeInputCost ?? 0),
    claudeOutputCost: String(input.claudeOutputCost ?? 0),
    usdToPkr: String(input.usdToPkr),
    currency: input.currency ?? "USD",
    taxMode: input.taxMode ?? "itemized",
    foreignTxnFeePct: String(input.foreignTxnFeePct ?? 0),
    fedPct: String(input.fedPct ?? 0),
    advanceTaxPct: String(input.advanceTaxPct ?? 0),
    additionalTaxPct: String(input.additionalTaxPct ?? 0),
    totalTaxPct: String(input.totalTaxPct ?? 0),
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
 * Serving cost over a resolved range: AI scribe + outbound WhatsApp, split three ways
 * — grand totals, per clinic (for the table), and per time bucket (for the trend
 * chart). **Scribe cost is METERED** — Σ `ai_usage.cost_pkr` (Whisper minutes +
 * Claude tokens, snapshotted at record time); a visit-with-audio that has NO metered
 * usage falls back to the flat `scribe_call_cost` estimate. WhatsApp stays count ×
 * rate. One local-time pass keeps the per-clinic + per-bucket views consistent
 * (matching the sales report), avoiding DB-timezone bucket drift.
 */
export async function computeServingCost(range: ResolvedRange): Promise<ServingCost> {
  const { start, end, granularity } = range;
  return unscoped("admin: serving cost", async () => {
    const rates = await getCostRates();
    const scribeEstUnit = rates.scribeCallCost * rates.usdToPkr; // fallback per un-metered call
    const waUnit = rates.whatsappMsgCost * rates.usdToPkr; // PKR per WhatsApp message
    // Bank international-transaction tax/charges markup — applied to the final PKR cost
    // (ai_usage.cost_pkr + estimates + WhatsApp), since the raw usage rows are the
    // provider's charge, not what the bank actually deducted.
    const taxMult = computeTaxMultiplier(rates);

    // Scribe = visits WITH audio (a scribe run). Metered cost comes from ai_usage;
    // WhatsApp = OUTBOUND messages (sends cost money; inbound is typically free).
    const [scribeRows, waRows, usageRows, clinicRows] = await Promise.all([
      db
        .select({ id: visits.id, clinicId: visits.clinicId, at: visits.createdAt })
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
      db
        .select({ clinicId: aiUsage.clinicId, at: aiUsage.occurredAt, costPkr: aiUsage.costPkr, visitId: aiUsage.visitId })
        .from(aiUsage)
        .where(and(gte(aiUsage.occurredAt, start), lt(aiUsage.occurredAt, end))),
      db.select({ id: clinics.id, name: clinics.name }).from(clinics).where(notDeleted(clinics.deletedAt)),
    ]);
    const nameOf = new Map(clinicRows.map((c) => [c.id, c.name]));
    const meteredVisitIds = new Set(usageRows.map((r) => r.visitId).filter((v): v is string => !!v));

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
    // Scribe cost accrues separately from the call COUNT (metered ≠ count × rate).
    const scribeCostByClinic = new Map<string, number>();
    const waCostByClinic = new Map<string, number>();
    const addScribeCost = (id: string | null, cost: number) => {
      const key = id ?? "unattributed";
      scribeCostByClinic.set(key, (scribeCostByClinic.get(key) ?? 0) + cost);
    };

    let totalScribeCalls = 0;
    let totalWhatsappMsgs = 0;

    // 1. Metered AI cost (Whisper + Claude), by clinic + bucket (by occurredAt).
    for (const r of usageRows) {
      clinicRow(r.clinicId);
      addScribeCost(r.clinicId, r.costPkr);
      const b = bucketFor(r.at);
      if (b) b.scribeCostPkr += r.costPkr;
    }
    // 2. Scribe CALL count (every audio visit) + estimate fallback for un-metered ones.
    for (const r of scribeRows) {
      clinicRow(r.clinicId).scribeCalls += 1;
      totalScribeCalls += 1;
      if (!meteredVisitIds.has(r.id)) {
        addScribeCost(r.clinicId, scribeEstUnit);
        const b = bucketFor(r.at);
        if (b) b.scribeCostPkr += scribeEstUnit;
      }
    }
    // 3. WhatsApp (count × rate).
    for (const r of waRows) {
      clinicRow(r.clinicId).whatsappMsgs += 1;
      totalWhatsappMsgs += 1;
      const key = r.clinicId ?? "unattributed";
      waCostByClinic.set(key, (waCostByClinic.get(key) ?? 0) + waUnit);
      const b = bucketFor(r.at);
      if (b) b.whatsappCostPkr += waUnit;
    }

    // Final PKR = raw provider cost × the bank tax/charges multiplier.
    let totalCostPkr = 0;
    for (const [key, e] of byClinic) {
      e.costPkr = Math.round(((scribeCostByClinic.get(key) ?? 0) + (waCostByClinic.get(key) ?? 0)) * taxMult);
      totalCostPkr += e.costPkr;
    }
    for (const b of buckets) {
      b.scribeCostPkr = Math.round(b.scribeCostPkr * taxMult);
      b.whatsappCostPkr = Math.round(b.whatsappCostPkr * taxMult);
      b.costPkr = b.scribeCostPkr + b.whatsappCostPkr;
    }
    const perClinic = [...byClinic.values()].sort((a, b) => b.costPkr - a.costPkr);
    return { from: start, to: end, rates, totalScribeCalls, totalWhatsappMsgs, totalCostPkr, perClinic, trend: buckets };
  });
}
