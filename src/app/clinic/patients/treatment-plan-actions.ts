"use server";

import { revalidatePath } from "next/cache";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import type { CurrentUser } from "@/core/types/auth";
import { treatmentTemplatesFor } from "@/config/modules";
import {
  addPlanItem,
  createPlan,
  createPlanFromTemplate,
  deletePlanItem,
  setPlanStatus,
  softDeletePlan,
  updatePlanItem,
} from "@/core/patients/treatment-plans";
import { logActivity } from "@/core/audit/log";

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
  await addPlanItem(g.clinicId, planId, input);
  return done(patientId);
}

export async function updatePlanItemAction(
  itemId: string,
  patientId: string,
  patch: { status?: string; tooth?: string | null; quantity?: number },
): Promise<State> {
  const g = await guard("edit");
  if ("error" in g) return g;
  await updatePlanItem(g.clinicId, itemId, patch);
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
  await setPlanStatus(g.clinicId, planId, status);
  return done(patientId);
}

export async function deletePlanAction(planId: string, patientId: string): Promise<State> {
  const g = await guard("delete");
  if ("error" in g) return g;
  await softDeletePlan(g.clinicId, planId, g.user.id);
  await logActivity({ action: "delete", entity: "patient", entityId: patientId, summary: "Deleted a treatment plan" });
  return done(patientId);
}

async function moduleList(clinicId: string): Promise<string[]> {
  const c = await getClinic(clinicId);
  return c?.modulesEnabled ?? [];
}
