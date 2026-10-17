"use server";

import { revalidatePath } from "next/cache";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import type { CurrentUser } from "@/core/types/auth";
import { clinicalRecordFor, treatmentTemplatesFor } from "@/config/modules";
import {
  addPlanItem,
  createPlan,
  createPlanFromTemplate,
  deletePlanItem,
  setPlanStatus,
  softDeletePlan,
  updatePlan,
  updatePlanItem,
  updatePlanTerms,
} from "@/core/patients/treatment-plans";
import { discountError, normalizeDiscountType } from "@/core/appointments/fee";
import { logActivity } from "@/core/audit/log";
import {
  asCode,
  TREATMENT_ITEM_STATUS_ROWS,
  TREATMENT_PLAN_STATUS_ROWS,
  type TreatmentItemStatusCode,
  type TreatmentPlanStatusCode,
} from "@/core/db/vocabulary-seed";

type State = { ok?: true; error?: string };
const actorOf = (u: CurrentUser) => ({ id: u.id, name: displayStaffName(u.prefix, u.fullName, u.username) });

async function guard(action: "create" | "edit" | "delete"): Promise<{ user: CurrentUser; clinicId: string } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "plans", action)) return { error: "You don't have permission for treatment plans." };
  return { user, clinicId: user.clinicId };
}
function done(patientId: string): State {
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}
async function clinicModule(clinicId: string): Promise<string> {
  const c = await getClinic(clinicId);
  return c?.modulesEnabled?.[0] ?? "";
}

export async function createPlanAction(patientId: string, title: string, note?: string): Promise<State> {
  const g = await guard("create");
  if ("error" in g) return g;
  if (!title.trim()) return { error: "Enter a plan title." };
  await createPlan(g.clinicId, { patientId, module: await clinicModule(g.clinicId), title: title.trim(), note: note || null }, actorOf(g.user));
  await logActivity({ action: "create", entity: "patient", entityId: patientId, summary: `Created treatment plan "${title.trim()}"` });
  return done(patientId);
}

export async function createPlanFromTemplateAction(patientId: string, templateName: string): Promise<State> {
  const g = await guard("create");
  if ("error" in g) return g;
  const template = treatmentTemplatesFor(await moduleList(g.clinicId)).find((t) => t.name === templateName);
  if (!template) return { error: "Template not found." };
  await createPlanFromTemplate(g.clinicId, { patientId, module: await clinicModule(g.clinicId), template }, actorOf(g.user));
  await logActivity({ action: "create", entity: "patient", entityId: patientId, summary: `Created treatment plan from "${templateName}"` });
  return done(patientId);
}

export async function addPlanItemAction(
  planId: string,
  patientId: string,
  input: { procedureId?: string | null; name: string; unitPrice: number; tooth?: string | null; quantity?: number },
): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  if (!input.name.trim()) return { error: "Choose a procedure." };
  const tooth = await tidyTeeth(g.clinicId, input.tooth);
  if (typeof tooth === "object" && tooth) return tooth;
  await addPlanItem(g.clinicId, planId, { ...input, tooth });
  return done(patientId);
}

export async function updatePlanItemAction(
  itemId: string,
  patientId: string,
  patch: {
    status?: string;
    tooth?: string | null;
    quantity?: number;
    unitPrice?: number;
    discount?: { type: string; value: number };
    removeOffer?: boolean;
  },
): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  const discount = patch.discount
    ? { type: normalizeDiscountType(patch.discount.type), value: Number(patch.discount.value) || 0 }
    : undefined;
  if (discount) {
    const e = discountError(discount.type, discount.value);
    if (e) return { error: e };
  }
  let tooth: string | null | undefined = undefined;
  if (patch.tooth !== undefined) {
    const t = await tidyTeeth(g.clinicId, patch.tooth);
    if (typeof t === "object" && t) return t;
    tooth = t;
  }
  await updatePlanItem(g.clinicId, itemId, {
    ...patch,
    discount,
    removeOffer: patch.removeOffer === true,
    tooth,
    status: asCode<TreatmentItemStatusCode>(TREATMENT_ITEM_STATUS_ROWS, patch.status),
  });
  return done(patientId);
}

export async function updatePlanAction(planId: string, patientId: string, title: string, note: string): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  if (!title.trim()) return { error: "Enter a plan title." };
  const ok = await updatePlan(g.clinicId, planId, { title: title.trim(), note: note.trim() || null });
  if (!ok) return { error: "That plan no longer exists." };
  await logActivity({ action: "update", entity: "patient", entityId: patientId, summary: `Edited treatment plan "${title.trim()}"` });
  return done(patientId);
}

/**
 * A plan's doctor and discount: the overall discount, and who gives it (the clinic,
 * the doctor, or both with the doctor's part). No approval — the plan IS the agreement
 * with the patient (owner's call, 2026-10-18).
 */
export async function updatePlanTermsAction(
  planId: string,
  patientId: string,
  input: { doctorId: string | null; discountType: string; discountValue: number; borneBy: string; splitType: string; splitValue: number },
): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  const discountType = normalizeDiscountType(input.discountType);
  const splitType = normalizeDiscountType(input.splitType);
  const borneBy = input.borneBy === "doctor" || input.borneBy === "split" ? input.borneBy : "clinic";
  const discountValue = Number(input.discountValue) || 0;
  const splitValue = Number(input.splitValue) || 0;
  const e = discountError(discountType, discountValue) ?? (borneBy === "split" ? discountError(splitType, splitValue) : null);
  if (e) return { error: e };
  const r = await updatePlanTerms(g.clinicId, planId, {
    doctorId: input.doctorId || null,
    discountType,
    discountValue,
    borneBy,
    splitType,
    splitValue,
  });
  if ("error" in r) return r;
  await logActivity({ action: "update", entity: "patient", entityId: patientId, summary: "Changed a treatment plan's doctor or discount" });
  return done(patientId);
}

export async function deletePlanItemAction(itemId: string, patientId: string): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  await deletePlanItem(g.clinicId, itemId);
  return done(patientId);
}

export async function setPlanStatusAction(planId: string, patientId: string, status: string): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  const code = asCode<TreatmentPlanStatusCode>(TREATMENT_PLAN_STATUS_ROWS, status);
  if (!code) return { error: "Unknown status." };
  await setPlanStatus(g.clinicId, planId, code);
  return done(patientId);
}

export async function deletePlanAction(planId: string, patientId: string): Promise<State> {
  const g = await guard("delete");
  if ("error" in g) return g;
  await softDeletePlan(g.clinicId, planId, g.user.id);
  await logActivity({ action: "delete", entity: "patient", entityId: patientId, summary: "Deleted a treatment plan" });
  return done(patientId);
}

/**
 * A plan item's teeth, checked and tidied: "47 48,53" → "47, 48, 53" (owner's call,
 * 2026-10-15 — a bridge or a set of fillings is one line on the plan). The enabled
 * module decides what a valid tooth is; without one, core only splits and de-dupes.
 * Returns the stored text (null when empty) or an error to show.
 */
async function tidyTeeth(clinicId: string, raw: string | null | undefined): Promise<string | null | { error: string }> {
  const parse = clinicalRecordFor(await moduleList(clinicId))?.parseItemList;
  const parsed = parse
    ? parse(raw)
    : { items: [...new Set((raw ?? "").split(/[\s,;/]+/).map((x) => x.trim()).filter(Boolean))] };
  if ("error" in parsed) return { error: parsed.error };
  return parsed.items.length ? parsed.items.join(", ") : null;
}

async function moduleList(clinicId: string): Promise<string[]> {
  const c = await getClinic(clinicId);
  return c?.modulesEnabled ?? [];
}
