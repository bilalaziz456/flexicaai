import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  appointmentProcedures,
  appointments,
  procedures,
  treatmentPlanItems,
  treatmentPlans,
  users,
  type TreatmentPlan,
  type TreatmentPlanItem,
} from "@/core/db/schema";
import { activeOffersOn } from "@/core/appointments/procedures";
import { localDateStr } from "@/core/appointments/availability";
import { clampDiscountValue, type DiscountType } from "@/core/appointments/fee";
import { computePlanBill, visitPlanDiscount, type PlanBearer, type VisitPlanDiscount } from "@/core/patients/plan-bill";
import { displayStaffName } from "@/core/types/auth";
import type { TreatmentTemplate } from "@/core/types/module";
import type { TreatmentItemStatusCode, TreatmentPlanStatusCode } from "@/core/db/vocabulary-seed";

/**
 * Treatment plans — CORE data layer (server-only). A plan is a multi-visit course;
 * its items are priced (snapshot) procedures. Scheduling an item onto an appointment
 * mints an `appointment_procedures` line, so plans feed Sales via the same path.
 * All clinic-scoped.
 */

type Actor = { id: string; name: string };
export type PlanWithItems = TreatmentPlan & { items: TreatmentPlanItem[] };

/** A patient's live plans, each with its items (sorted). Newest plan first. */
export async function listPlans(clinicId: string, patientId: string): Promise<PlanWithItems[]> {
  const plans = await db
    .select()
    .from(treatmentPlans)
    .where(
      byClinic(
        treatmentPlans.clinicId,
        clinicId,
        notDeleted(treatmentPlans.deletedAt),
        eq(treatmentPlans.patientId, patientId),
      ),
    )
    .orderBy(asc(treatmentPlans.status), treatmentPlans.createdAt);
  if (plans.length === 0) return [];

  const items = await db
    .select()
    .from(treatmentPlanItems)
    .where(
      byClinic(
        treatmentPlanItems.clinicId,
        clinicId,
        inArray(treatmentPlanItems.planId, plans.map((p) => p.id)),
      ),
    )
    .orderBy(asc(treatmentPlanItems.sort), asc(treatmentPlanItems.createdAt));

  return plans.map((p) => ({ ...p, items: items.filter((i) => i.planId === p.id) }));
}

/** Create an empty plan. */
export async function createPlan(
  clinicId: string,
  input: { patientId: string; module: string; title: string; note?: string | null; doctorId?: string | null },
  actor: Actor,
): Promise<{ id: string }> {
  // Only one of this clinic's doctors can be the plan's; anything else is dropped
  // rather than refusing the plan (the doctor is optional).
  const doctorId = input.doctorId && (await isClinicDoctor(clinicId, input.doctorId)) ? input.doctorId : null;
  const [row] = await db
    .insert(treatmentPlans)
    .values({
      clinicId,
      patientId: input.patientId,
      doctorId,
      module: input.module || "",
      title: input.title.slice(0, 160) || "Treatment plan",
      note: input.note?.slice(0, 1000) ?? null,
      createdBy: actor.id,
      createdByName: actor.name,
    })
    .returning({ id: treatmentPlans.id });
  return { id: row.id };
}

/**
 * Create a plan from a module template — matches each template item NAME to the
 * clinic's priced procedures for the snapshot price (unmatched still add at price 0).
 */
export async function createPlanFromTemplate(
  clinicId: string,
  input: { patientId: string; module: string; template: TreatmentTemplate; doctorId?: string | null },
  actor: Actor,
): Promise<{ id: string }> {
  const catalog = await db
    .select({ id: procedures.id, name: procedures.name, price: procedures.price })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)));
  const byName = new Map(catalog.map((p) => [p.name.toLowerCase(), p]));
  const offers = await activeOffersOn(clinicId, catalog.map((p) => p.id), localDateStr(new Date()));

  const { id } = await createPlan(
    clinicId,
    { patientId: input.patientId, module: input.module, title: input.template.name, doctorId: input.doctorId },
    actor,
  );
  const rows = input.template.items.map((name, i) => {
    const match = byName.get(name.toLowerCase());
    return {
      clinicId,
      planId: id,
      procedureId: match?.id ?? null,
      name: match?.name ?? name,
      unitPrice: match?.price ?? 0,
      quantity: 1,
      ...offerFields(match ? offers.get(match.id) : undefined),
      sort: i,
    };
  });
  if (rows.length) await db.insert(treatmentPlanItems).values(rows);
  return { id };
}

/** Add one item to a plan (snapshotting the procedure's price). */
export async function addPlanItem(
  clinicId: string,
  planId: string,
  input: { procedureId?: string | null; name: string; unitPrice: number; tooth?: string | null; quantity?: number },
): Promise<{ id: string }> {
  // The offer running TODAY is snapshotted onto the item: the estimate is a promise,
  // so the offer ending before the visit does not take it back.
  const offer = input.procedureId
    ? (await activeOffersOn(clinicId, [input.procedureId], localDateStr(new Date()))).get(input.procedureId)
    : undefined;
  const [row] = await db
    .insert(treatmentPlanItems)
    .values({
      clinicId,
      planId,
      ...offerFields(offer),
      procedureId: input.procedureId ?? null,
      name: input.name.slice(0, 160),
      unitPrice: Math.max(0, Math.round(input.unitPrice)),
      // A tidied list ("47, 48, 53") — the action checked it through the module.
      tooth: input.tooth?.slice(0, 200) || null,
      quantity: Math.max(1, input.quantity ?? 1),
    })
    .returning({ id: treatmentPlanItems.id });
  return { id: row.id };
}

/** Update an item's mutable fields (status, tooth, quantity). Clinic-scoped. */
export async function updatePlanItem(
  clinicId: string,
  itemId: string,
  patch: {
    status?: TreatmentItemStatusCode;
    tooth?: string | null;
    quantity?: number;
    unitPrice?: number;
    discount?: { type: DiscountType; value: number };
    /** "Remove offer": the item stops carrying the clinic offer it was added with. */
    removeOffer?: boolean;
  },
): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) set.status = patch.status;
  // An estimate's price is the clinic's to adjust per patient; the catalog is untouched.
  if (patch.unitPrice !== undefined) set.unitPrice = Math.max(0, Math.round(patch.unitPrice));
  if (patch.tooth !== undefined) set.tooth = patch.tooth?.slice(0, 200) || null;
  if (patch.quantity !== undefined) set.quantity = Math.max(1, patch.quantity);
  if (patch.discount) {
    set.discountType = patch.discount.type;
    set.discountValue = clampDiscountValue(patch.discount.type, patch.discount.value);
  }
  if (patch.removeOffer) Object.assign(set, offerFields(undefined));
  const res = await db
    .update(treatmentPlanItems)
    .set(set)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, eq(treatmentPlanItems.id, itemId)))
    .returning({ id: treatmentPlanItems.id });
  return res.length > 0;
}

export async function deletePlanItem(clinicId: string, itemId: string): Promise<boolean> {
  const res = await db
    .delete(treatmentPlanItems)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, eq(treatmentPlanItems.id, itemId)))
    .returning({ id: treatmentPlanItems.id });
  return res.length > 0;
}

/** Rename a plan or change its note. Clinic-scoped; a trashed plan is not touched. */
export async function updatePlan(
  clinicId: string,
  planId: string,
  patch: { title: string; note: string | null },
): Promise<boolean> {
  const res = await db
    .update(treatmentPlans)
    .set({ title: patch.title.slice(0, 200), note: patch.note?.slice(0, 2000) || null, updatedAt: new Date() })
    .where(byClinic(treatmentPlans.clinicId, clinicId, notDeleted(treatmentPlans.deletedAt), eq(treatmentPlans.id, planId)))
    .returning({ id: treatmentPlans.id });
  return res.length > 0;
}

export async function setPlanStatus(clinicId: string, planId: string, status: TreatmentPlanStatusCode): Promise<boolean> {
  const res = await db
    .update(treatmentPlans)
    .set({ status, updatedAt: new Date() })
    .where(byClinic(treatmentPlans.clinicId, clinicId, notDeleted(treatmentPlans.deletedAt), eq(treatmentPlans.id, planId)))
    .returning({ id: treatmentPlans.id });
  return res.length > 0;
}

export async function softDeletePlan(clinicId: string, planId: string, actorId: string): Promise<boolean> {
  const res = await db
    .update(treatmentPlans)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(byClinic(treatmentPlans.clinicId, clinicId, notDeleted(treatmentPlans.deletedAt), eq(treatmentPlans.id, planId)))
    .returning({ id: treatmentPlans.id });
  return res.length > 0;
}

/** A patient's planned, not-yet-scheduled items — for booking-from-plan. */
export async function getUnscheduledItems(
  clinicId: string,
  patientId: string,
): Promise<(TreatmentPlanItem & { planTitle: string })[]> {
  const rows = await db
    .select({ item: treatmentPlanItems, planTitle: treatmentPlans.title })
    .from(treatmentPlanItems)
    .innerJoin(treatmentPlans, eq(treatmentPlans.id, treatmentPlanItems.planId))
    .where(
      byClinic(
        treatmentPlanItems.clinicId,
        clinicId,
        eq(treatmentPlans.patientId, patientId),
        notDeleted(treatmentPlans.deletedAt),
        eq(treatmentPlanItems.status, "planned"),
        isNull(treatmentPlanItems.appointmentId),
      ),
    )
    .orderBy(asc(treatmentPlanItems.sort));
  return rows.map((r) => ({ ...r.item, planTitle: r.planTitle }));
}

/**
 * Attach plan items to an appointment — link them + mark `in_progress`, and mint an
 * `appointment_procedures` line for each so the visit bills exactly like an ad-hoc
 * procedure (one money path). Called from booking-from-plan.
 *
 * Each line carries what a procedure booked any other way carries: the visit's doctor
 * as the PERFORMING doctor (who earns its share — without it the clinic kept the whole
 * line), and the item's snapshotted clinic OFFER as the line discount. The plan's own
 * discount is not on the line: it is a patient discount, placed on the appointment by
 * the booking action (`planDiscountForItems`), where "Discount borne by" applies.
 */
export async function scheduleItemsOnAppointment(
  clinicId: string,
  appointmentId: string,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  const [appt] = await db
    .select({ doctorId: appointments.doctorId })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  const items = await db
    .select()
    .from(treatmentPlanItems)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, inArray(treatmentPlanItems.id, itemIds)));

  await db.transaction(async (tx) => {
    for (const it of items) {
      await tx.insert(appointmentProcedures).values({
        clinicId,
        appointmentId,
        procedureId: it.procedureId,
        name: it.name,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        doctorId: appt?.doctorId ?? null,
        discountType: it.offerType,
        discountValue: it.offerValue,
      });
      await tx
        .update(treatmentPlanItems)
        .set({ appointmentId, status: "in_progress", updatedAt: new Date() })
        .where(and(eq(treatmentPlanItems.clinicId, clinicId), eq(treatmentPlanItems.id, it.id)));
    }
  });
}

/** The offer columns for an item: the offer given, or none. */
function offerFields(offer: { type: DiscountType; value: number } | undefined) {
  return offer && offer.value > 0
    ? { offerType: offer.type, offerValue: clampDiscountValue(offer.type, offer.value) }
    : { offerType: "amount" as const, offerValue: 0 };
}

export type PlanTerms = {
  doctorId: string | null;
  discountType: DiscountType;
  discountValue: number;
  borneBy: PlanBearer;
  splitType: DiscountType;
  splitValue: number;
};

/**
 * Set a plan's doctor and discount terms. The doctor must be one of this clinic's
 * staff (tenant check); a doctor or split discount needs one, since the estimate
 * prints whose discount it is and the visit charges it to that doctor's share.
 */
export async function updatePlanTerms(
  clinicId: string,
  planId: string,
  terms: PlanTerms,
): Promise<{ ok: true } | { error: string }> {
  if (terms.doctorId) {
    const [doc] = await db
      .select({ id: users.id })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, terms.doctorId)))
      .limit(1);
    if (!doc) return { error: "That doctor is not on this clinic's staff." };
  }
  if (terms.borneBy !== "clinic" && !terms.doctorId) {
    return { error: "Choose the plan's doctor — the discount is given by the doctor." };
  }
  const res = await db
    .update(treatmentPlans)
    .set({
      doctorId: terms.doctorId,
      discountType: terms.discountType,
      discountValue: clampDiscountValue(terms.discountType, terms.discountValue),
      discountBorneBy: terms.borneBy,
      discountSplitType: terms.splitType,
      discountSplitValue: terms.borneBy === "split" ? clampDiscountValue(terms.splitType, terms.splitValue) : 0,
      updatedAt: new Date(),
    })
    .where(byClinic(treatmentPlans.clinicId, clinicId, notDeleted(treatmentPlans.deletedAt), eq(treatmentPlans.id, planId)))
    .returning({ id: treatmentPlans.id });
  return res.length > 0 ? { ok: true } : { error: "That plan no longer exists." };
}

/** What a visit booked with some of a plan's items carries from the plan. */
export type PlanItemCarry = {
  id: string;
  planId: string;
  /** This item's plan discount (own + its share of the overall), in PKR. */
  planDiscount: number;
  borneBy: PlanBearer;
  split: { type: DiscountType; value: number };
  /** The whole plan's discount — what a flat split amount is a part of. */
  planDiscountTotal: number;
  doctorName: string | null;
};

/**
 * Each plan item's carry, computed over its WHOLE plan (the overall discount is
 * allocated across every live item, so a share depends on the others). Clinic-scoped;
 * items of trashed plans are left out.
 */
export async function getPlanItemCarry(clinicId: string, itemIds: string[]): Promise<Map<string, PlanItemCarry>> {
  const out = new Map<string, PlanItemCarry>();
  if (itemIds.length === 0) return out;
  const planIds = (
    await db
      .selectDistinct({ planId: treatmentPlanItems.planId })
      .from(treatmentPlanItems)
      .where(byClinic(treatmentPlanItems.clinicId, clinicId, inArray(treatmentPlanItems.id, itemIds)))
  ).map((r) => r.planId);
  if (planIds.length === 0) return out;
  const plans = await db
    .select({ plan: treatmentPlans, doctorPrefix: users.prefix, doctorName: users.fullName })
    .from(treatmentPlans)
    .leftJoin(users, eq(users.id, treatmentPlans.doctorId))
    .where(byClinic(treatmentPlans.clinicId, clinicId, notDeleted(treatmentPlans.deletedAt), inArray(treatmentPlans.id, planIds)));
  const items = await db
    .select()
    .from(treatmentPlanItems)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, inArray(treatmentPlanItems.planId, planIds)))
    .orderBy(asc(treatmentPlanItems.sort), asc(treatmentPlanItems.createdAt));
  for (const { plan, doctorPrefix, doctorName } of plans) {
    const mine = items.filter((i) => i.planId === plan.id);
    const bill = planBillOf(plan, mine);
    mine.forEach((it, i) => {
      out.set(it.id, {
        id: it.id,
        planId: plan.id,
        planDiscount: bill.items[i].planDiscount,
        borneBy: plan.discountBorneBy,
        split: { type: plan.discountSplitType, value: plan.discountSplitValue },
        planDiscountTotal: bill.planDiscount,
        doctorName: doctorName ? displayStaffName(doctorPrefix, doctorName) : null,
      });
    });
  }
  return out;
}

/** A plan's bill from its stored rows — the one place rows become `computePlanBill` input. */
export function planBillOf(plan: TreatmentPlan, items: TreatmentPlanItem[]) {
  return computePlanBill(
    items.map((it) => ({
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      offerType: it.offerType,
      offerValue: it.offerValue,
      discountType: it.discountType,
      discountValue: it.discountValue,
      cancelled: it.status === "cancelled",
    })),
    { type: plan.discountType, value: plan.discountValue },
  );
}

/**
 * The patient discount a visit booked with `itemIds` takes from their plan(s): the
 * amount, who bears it, and the split. Null when they carry none. An error when the
 * items come from plans whose discounts are given by different people — one visit has
 * one "Discount borne by", so those must be booked on separate visits.
 */
export async function planDiscountForItems(
  clinicId: string,
  itemIds: string[],
): Promise<VisitPlanDiscount | { error: string } | null> {
  const carry = await getPlanItemCarry(clinicId, itemIds);
  return visitPlanDiscount(itemIds.map((id) => carry.get(id)).filter((c): c is PlanItemCarry => Boolean(c)));
}

/** One treatment plan's header, for the printed estimate. */
export async function getTreatmentPlan(clinicId: string, planId: string) {
  const [row] = await db
    .select({ plan: treatmentPlans, doctorPrefix: users.prefix, doctorName: users.fullName })
    .from(treatmentPlans)
    .leftJoin(users, eq(users.id, treatmentPlans.doctorId))
    .where(byClinic(treatmentPlans.clinicId, clinicId, eq(treatmentPlans.id, planId)))
    .limit(1);
  if (!row) return null;
  return {
    ...row.plan,
    // "Dr. Sana Ali" — whose discount it is, on the printed estimate.
    doctorName: row.doctorName ? displayStaffName(row.doctorPrefix, row.doctorName) : null,
  };
}

/** A plan's line items, in the order the clinician arranged them. */
export async function listTreatmentPlanItems(clinicId: string, planId: string) {
  return db
    .select()
    .from(treatmentPlanItems)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, eq(treatmentPlanItems.planId, planId)))
    .orderBy(asc(treatmentPlanItems.sort), asc(treatmentPlanItems.createdAt));
}

/**
 * A patient's bookable plan items for the booking form, each with what it brings to
 * the visit: its price and clinic offer (the line), and its plan discount with who
 * gives it (the appointment's discount). The form previews the same figures the
 * server will book (`planDiscountForItems`).
 */
export async function getBookablePlanItems(clinicId: string, patientId: string) {
  const items = await getUnscheduledItems(clinicId, patientId);
  const carry = await getPlanItemCarry(clinicId, items.map((i) => i.id));
  return items.map((i) => {
    const c = carry.get(i.id);
    return {
      id: i.id,
      name: i.name,
      tooth: i.tooth,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      planTitle: i.planTitle,
      planId: i.planId,
      offerType: i.offerType,
      offerValue: i.offerValue,
      planDiscount: c?.planDiscount ?? 0,
      borneBy: c?.borneBy ?? ("clinic" as PlanBearer),
      split: c?.split ?? { type: "percent" as DiscountType, value: 0 },
      planDiscountTotal: c?.planDiscountTotal ?? 0,
      doctorName: c?.doctorName ?? null,
    };
  });
}
export type BookablePlanItem = Awaited<ReturnType<typeof getBookablePlanItems>>[number];

async function isClinicDoctor(clinicId: string, userId: string): Promise<boolean> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, userId)))
    .limit(1);
  return Boolean(u);
}

/**
 * Who a NEW plan's doctor probably is, to pre-fill the choice (owner's call,
 * 2026-10-18 — asked when the plan is made, not later behind its discount): the person
 * making it when they are one of the clinic's doctors; else the doctor of the
 * patient's visit today; else of their most recent visit; else nobody. Only a
 * suggestion — it can be changed or cleared.
 */
export async function suggestPlanDoctorId(
  clinicId: string,
  patientId: string,
  viewer: { id: string; isDoctor: boolean } | null,
): Promise<string | null> {
  if (viewer?.isDoctor) return viewer.id;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const base = (when: ReturnType<typeof and>) =>
    db
      .select({ doctorId: appointments.doctorId })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          eq(appointments.patientId, patientId),
          isNotNull(appointments.doctorId),
          notInArray(appointments.status, ["cancelled", "no_show"]),
          when,
        ),
      );
  const [today] = await base(and(gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, end)))
    .orderBy(asc(appointments.scheduledAt))
    .limit(1);
  if (today?.doctorId) return today.doctorId;
  const [latest] = await base(and(lte(appointments.scheduledAt, new Date())))
    .orderBy(desc(appointments.scheduledAt))
    .limit(1);
  return latest?.doctorId ?? null;
}
