import "server-only";

import { and, count, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { clinics, platformCostRates, visits, whatsappMessages } from "@/core/db/schema";

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

export type ServingCost = {
  from: Date;
  to: Date;
  rates: CostRates;
  totalScribeCalls: number;
  totalWhatsappMsgs: number;
  totalCostPkr: number;
  perClinic: ClinicCost[];
};

/**
 * Estimated serving cost over [from, to): scribe calls (visits with audio) + outbound
 * WhatsApp, per clinic and total, priced at the CURRENT rates. (v1 uses current rates
 * for the whole window; historical per-period rate costing is a later refinement.)
 */
export async function computeServingCost({ from, to }: { from: Date; to: Date }): Promise<ServingCost> {
  return unscoped("admin: serving cost", async () => {
    const rates = await getCostRates();

    // Scribe calls = visits WITH audio (Whisper+Claude ran), per clinic, in range.
    const scribeRows = await db
      .select({ clinicId: visits.clinicId, c: count() })
      .from(visits)
      .where(and(isNotNull(visits.audioKey), gte(visits.createdAt, from), lt(visits.createdAt, to)))
      .groupBy(visits.clinicId);

    // WhatsApp = OUTBOUND messages (sends cost money; inbound is typically free), per clinic.
    const waRows = await db
      .select({ clinicId: whatsappMessages.clinicId, c: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.direction, "outbound"),
          isNotNull(whatsappMessages.clinicId),
          gte(whatsappMessages.createdAt, from),
          lt(whatsappMessages.createdAt, to),
        ),
      )
      .groupBy(whatsappMessages.clinicId);

    const clinicRows = await db
      .select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .where(notDeleted(clinics.deletedAt));
    const nameOf = new Map(clinicRows.map((c) => [c.id, c.name]));

    const byClinic = new Map<string, ClinicCost>();
    const row = (id: string | null): ClinicCost => {
      const key = id ?? "unattributed";
      let e = byClinic.get(key);
      if (!e) {
        e = { clinicId: key, name: id ? (nameOf.get(id) ?? "—") : "Unattributed", scribeCalls: 0, whatsappMsgs: 0, costPkr: 0 };
        byClinic.set(key, e);
      }
      return e;
    };
    for (const r of scribeRows) row(r.clinicId).scribeCalls = n(r.c);
    for (const r of waRows) row(r.clinicId).whatsappMsgs = n(r.c);

    let totalScribeCalls = 0;
    let totalWhatsappMsgs = 0;
    let totalCostPkr = 0;
    for (const e of byClinic.values()) {
      e.costPkr = Math.round((e.scribeCalls * rates.scribeCallCost + e.whatsappMsgs * rates.whatsappMsgCost) * rates.usdToPkr);
      totalScribeCalls += e.scribeCalls;
      totalWhatsappMsgs += e.whatsappMsgs;
      totalCostPkr += e.costPkr;
    }
    const perClinic = [...byClinic.values()].sort((a, b) => b.costPkr - a.costPkr);
    return { from, to, rates, totalScribeCalls, totalWhatsappMsgs, totalCostPkr, perClinic };
  });
}
