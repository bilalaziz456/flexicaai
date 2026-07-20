"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
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
