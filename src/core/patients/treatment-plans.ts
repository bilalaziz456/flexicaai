import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  appointmentProcedures,
  procedures,
  treatmentPlanItems,
  treatmentPlans,
  type TreatmentPlan,
  type TreatmentPlanItem,
} from "@/core/db/schema";
import type { TreatmentTemplate } from "@/core/types/module";

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
  input: { patientId: string; module: string; title: string; note?: string | null },
  actor: Actor,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(treatmentPlans)
    .values({
      clinicId,
      patientId: input.patientId,
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
  input: { patientId: string; module: string; template: TreatmentTemplate },
  actor: Actor,
): Promise<{ id: string }> {
  const catalog = await db
    .select({ id: procedures.id, name: procedures.name, price: procedures.price })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)));
  const byName = new Map(catalog.map((p) => [p.name.toLowerCase(), p]));

  const { id } = await createPlan(
    clinicId,
    { patientId: input.patientId, module: input.module, title: input.template.name },
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
  const [row] = await db
    .insert(treatmentPlanItems)
    .values({
      clinicId,
      planId,
      procedureId: input.procedureId ?? null,
      name: input.name.slice(0, 160),
      unitPrice: Math.max(0, Math.round(input.unitPrice)),
      tooth: input.tooth?.slice(0, 4) || null,
      quantity: Math.max(1, input.quantity ?? 1),
    })
    .returning({ id: treatmentPlanItems.id });
  return { id: row.id };
}

/** Update an item's mutable fields (status, tooth, quantity). Clinic-scoped. */
export async function updatePlanItem(
  clinicId: string,
  itemId: string,
  patch: { status?: string; tooth?: string | null; quantity?: number },
): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) set.status = patch.status;
  if (patch.tooth !== undefined) set.tooth = patch.tooth?.slice(0, 4) || null;
  if (patch.quantity !== undefined) set.quantity = Math.max(1, patch.quantity);
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

export async function setPlanStatus(clinicId: string, planId: string, status: string): Promise<boolean> {
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
 */
export async function scheduleItemsOnAppointment(
  clinicId: string,
  appointmentId: string,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
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
      });
      await tx
        .update(treatmentPlanItems)
        .set({ appointmentId, status: "in_progress", updatedAt: new Date() })
        .where(and(eq(treatmentPlanItems.clinicId, clinicId), eq(treatmentPlanItems.id, it.id)));
    }
  });
}

/** One treatment plan's header, for the printed estimate. */
export async function getTreatmentPlan(clinicId: string, planId: string) {
  const [row] = await db
    .select({
      id: treatmentPlans.id,
      title: treatmentPlans.title,
      status: treatmentPlans.status,
      note: treatmentPlans.note,
      createdAt: treatmentPlans.createdAt,
    })
    .from(treatmentPlans)
    .where(byClinic(treatmentPlans.clinicId, clinicId, eq(treatmentPlans.id, planId)))
    .limit(1);
  return row ?? null;
}

/** A plan's line items, in the order the clinician arranged them. */
export async function listTreatmentPlanItems(clinicId: string, planId: string) {
  return db
    .select()
    .from(treatmentPlanItems)
    .where(byClinic(treatmentPlanItems.clinicId, clinicId, eq(treatmentPlanItems.planId, planId)))
    .orderBy(asc(treatmentPlanItems.sort), asc(treatmentPlanItems.createdAt));
}
