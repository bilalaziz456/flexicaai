"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import type { CurrentUser } from "@/core/types/auth";
import type { ModuleLab } from "@/core/types/module";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicalRecordFor } from "@/config/modules";
import { saveMedicalHistory } from "@/core/patients/medical-history";
import { asMedicalHistory } from "@/core/lib/medical-history";
import { logActivity } from "@/core/audit/log";

/**
 * Save the patient's baseline / existing-conditions chart (the "edit chart" flow on
 * the patient page). Module-agnostic via the clinicalRecord contract; gated by
 * `clinical:edit` (editing a clinical record). Re-check is enforced here even though
 * the UI hides the button.
 */
export async function saveBaselineChart(
  patientId: string,
  chart: unknown,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }

  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  if (!clinicalRecord) return { error: "This clinic has no clinical chart." };

  await clinicalRecord.saveBaseline(user.clinicId, patientId, chart);

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: "Edited the patient's chart (existing conditions)",
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/**
 * Record a new periodontal exam (a dated full snapshot). Module-agnostic via the
 * clinicalRecord `perio` bundle; gated by `clinical:edit`.
 */
export async function savePerioExamAction(
  patientId: string,
  teeth: unknown,
  note?: string | null,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }

  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const clinicalRecord = clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
  if (!clinicalRecord?.perio) return { error: "Periodontal charting isn't available." };

  await clinicalRecord.perio.saveExam(
    user.clinicId,
    patientId,
    { teeth, note: note ?? null },
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  );

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: "Recorded a periodontal exam",
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/** Save the patient's medical & dental history. Gated by `clinical:edit`. */
export async function saveMedicalHistoryAction(
  patientId: string,
  data: unknown,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }

  await saveMedicalHistory(user.clinicId, patientId, asMedicalHistory(data), {
    id: user.id,
    name: displayStaffName(user.prefix, user.fullName, user.username),
  });

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: "Updated medical history",
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

// ─── Lab cases (crowns/dentures) — module-agnostic via clinicalRecord.lab ────

type State = { ok: true } | { error: string };

async function labGuard(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string; lab: ModuleLab } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "lab", action)) return { error: "You don't have permission for lab cases." };
  const [c] = await db.select({ m: clinics.modulesEnabled }).from(clinics).where(eq(clinics.id, user.clinicId)).limit(1);
  const lab = clinicalRecordFor(c?.m ?? [])?.lab;
  if (!lab) return { error: "Lab tracking isn't available." };
  return { user, clinicId: user.clinicId, lab };
}
function labDone(patientId: string): State {
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

export async function saveLabCaseAction(
  patientId: string,
  input: { labName?: string | null; item: string; tooth?: string | null; shade?: string | null; dueAt?: string | null; cost?: number | null; note?: string | null },
): Promise<State> {
  const g = await labGuard("create");
  if ("error" in g) return g;
  if (!input.item?.trim()) return { error: "Choose an item type." };
  await g.lab.saveCase(g.clinicId, patientId, input, {
    id: g.user.id,
    name: displayStaffName(g.user.prefix, g.user.fullName, g.user.username),
  });
  await logActivity({ action: "create", entity: "patient", entityId: patientId, summary: `Sent a lab case (${input.item})` });
  return labDone(patientId);
}

export async function updateLabStatusAction(caseId: string, patientId: string, status: string): Promise<State> {
  const g = await labGuard("edit");
  if ("error" in g) return g;
  await g.lab.updateStatus(g.clinicId, caseId, status);
  await logActivity({ action: "update", entity: "patient", entityId: patientId, summary: `Lab case → ${status}` });
  return labDone(patientId);
}

export async function deleteLabCaseAction(caseId: string, patientId: string): Promise<State> {
  const g = await labGuard("delete");
  if ("error" in g) return g;
  await g.lab.deleteCase(g.clinicId, caseId, g.user.id);
  await logActivity({ action: "delete", entity: "patient", entityId: patientId, summary: "Removed a lab case" });
  return labDone(patientId);
}
