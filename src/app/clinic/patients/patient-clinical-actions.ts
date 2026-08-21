"use server";

import { revalidatePath } from "next/cache";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import type { CurrentUser } from "@/core/types/auth";
import type { ChartItemHistoryEntry, ModuleLab } from "@/core/types/module";
import { clinicalRecordFor } from "@/config/modules";
import { saveMedicalHistory } from "@/core/patients/medical-history";
import { asMedicalHistory } from "@/core/lib/medical-history";
import { logActivity } from "@/core/audit/log";

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
 * Correct one recorded treatment in place. For fixing what was charted, not for
 * undoing it. Gated by `clinical:edit` and audit-logged.
 */
export async function editItemRecordAction(
  patientId: string,
  itemKey: string,
  recordId: string,
  state: unknown,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "manager"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "clinical", "edit")) {
    return { error: "You don't have permission to edit clinical records." };
  }
  const clinicalRecord = await clinicalRecordForUser(user.clinicId);
  if (!clinicalRecord) return { error: "This clinic has no clinical chart." };

  const result = await clinicalRecord.editItemRecord(
    user.clinicId,
    patientId,
    itemKey,
    recordId,
    state,
  );
  if ("error" in result) return result;

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: `Edited a recorded treatment on ${itemKey}`,
    metadata: { itemKey, recordId },
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/**
 * Remove one recorded treatment. A SOFT delete — the record is hidden and the chart
 * re-folds from what remains, so nothing is erased and it can be restored. Gated by
 * `clinical:edit` and audit-logged.
 */
export async function deleteItemRecordAction(
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

  const result = await clinicalRecord.deleteItemRecord(
    user.clinicId,
    patientId,
    itemKey,
    recordId,
    user.id,
  );
  if ("error" in result) return result;

  await logActivity({
    action: "delete",
    entity: "patient",
    entityId: patientId,
    summary: `Deleted a recorded treatment on ${itemKey}`,
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

/**
 * Record ONE item on the intake baseline — "already there when the patient came".
 * The counterpart to `recordItemTreatmentAction`, and the reason both exist is that
 * a pre-existing crown must not enter the history as a crown this clinic fitted.
 * Gated by `clinical:edit` and audit-logged.
 */
export async function setItemBaselineAction(
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

  const result = await clinicalRecord.setItemBaseline(user.clinicId, patientId, itemKey, state);
  if ("error" in result) return result;

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: `Recorded an existing condition on ${itemKey}`,
    metadata: { itemKey },
  });
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { ok: true };
}

/** The enabled module's clinical-record bundle for this clinic, or null. */
async function clinicalRecordForUser(clinicId: string) {
  const clinicRow = await getClinic(clinicId);
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

  const clinicRow = await getClinic(user.clinicId);
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
  const c = await getClinic(user.clinicId);
  const lab = clinicalRecordFor(c?.modulesEnabled ?? [])?.lab;
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
