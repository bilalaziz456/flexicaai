"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import type { CurrentUser } from "@/core/types/auth";
import type { ChartItemHistoryEntry, ModuleLab } from "@/core/types/module";
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
 * One charted item's history (a tooth, for dental) — oldest first.
 *
 * Read-only, so `clinical:view` is enough; a viewer who cannot edit still sees how
 * the tooth got to its current state, they just get no Undo buttons.
 */
export async function loadItemHistory(
  patientId: string,
  itemKey: string,
): Promise<ChartItemHistoryEntry[]> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId || !can(user, "clinical", "view")) return [];

  const clinicalRecord = await clinicalRecordForUser(user.clinicId);
  if (!clinicalRecord) return [];
  return clinicalRecord.itemHistory(user.clinicId, patientId, itemKey);
}

/**
 * Undo one entry on one charted item — an AMENDMENT (see the module's `amendItem`:
 * it appends a correcting record, it does not delete). Gated by `clinical:edit` and
 * audit-logged, because it changes what the patient's record says.
 */
export async function amendItemAction(
  patientId: string,
  itemKey: string,
  recordId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }

  const clinicalRecord = await clinicalRecordForUser(user.clinicId);
  if (!clinicalRecord) return { error: "This clinic has no clinical chart." };

  const result = await clinicalRecord.amendItem(user.clinicId, patientId, itemKey, recordId);
  if ("error" in result) return result;

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: `Corrected an entry on ${itemKey} in the patient's chart`,
    metadata: { itemKey, recordId },
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/**
 * Record a treatment on ONE charted item — its own dated record, so the item's
 * history accumulates instead of one entry being rewritten.
 *
 * This is the counterpart to `saveBaselineChart`, and the distinction is the point:
 * the baseline is what the patient arrived with and each save corrects it in place,
 * while a treatment is an event that happened and must stand alongside the ones
 * before it. Gated by `clinical:edit` and audit-logged.
 */
export async function recordItemTreatmentAction(
  patientId: string,
  itemKey: string,
  state: unknown,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }

  const clinicalRecord = await clinicalRecordForUser(user.clinicId);
  if (!clinicalRecord) return { error: "This clinic has no clinical chart." };

  const result = await clinicalRecord.recordItemTreatment(
    user.clinicId,
    patientId,
    itemKey,
    state,
  );
  if ("error" in result) return result;

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: `Recorded a treatment on ${itemKey}`,
    metadata: { itemKey },
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/** The enabled module's clinical-record bundle for this clinic, or null. */
async function clinicalRecordForUser(clinicId: string) {
  const [clinicRow] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return clinicalRecordFor(clinicRow?.modulesEnabled ?? []);
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
