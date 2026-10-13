"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { MAX_PRESCRIPTION_NOTES, asPrescriptionItems, checkPrescription } from "@/core/lib/prescription-items";
import {
  createPrescription,
  softDeletePrescription,
  updatePrescription,
} from "@/core/patients/prescriptions";

type State = { ok: true; id?: string } | { error: string };

const schema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  doctorId: z.string().uuid({ message: "Choose the doctor who prescribed it." }),
  prescribedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
  notes: z.string().max(MAX_PRESCRIPTION_NOTES, "Notes are too long.").nullable(),
  printDoctorName: z.boolean(),
});

/**
 * Saves a typed prescription — new (`id` null) or an edit. `prescriptions:create` /
 * `:edit` (the desk holds both by default). The medicine lines are checked and bounded
 * by `asPrescriptionItems`; an empty prescription is refused.
 */
export async function savePrescriptionAction(id: string | null, raw: unknown): Promise<State> {
  const user = await requireWorkspace();
  if (!can(user, "prescriptions", id ? "edit" : "create")) {
    return { error: "You don't have permission to do that." };
  }
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const parsed = schema.safeParse({
    patientId: o.patientId,
    appointmentId: o.appointmentId || null,
    doctorId: o.doctorId,
    prescribedOn: o.prescribedOn,
    notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : null,
    printDoctorName: o.printDoctorName === true,
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  // The same checks the form ran, again here — a form is not a guarantee.
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const problems = checkPrescription(
    { doctorId: parsed.data.doctorId, prescribedOn: parsed.data.prescribedOn, items: rawItems, notes: parsed.data.notes },
    today,
  );
  if (problems.length > 0) return { error: problems[0].message };
  const items = asPrescriptionItems(rawItems);
  if (items.length === 0) return { error: "Add at least one medicine." };

  const input = { ...parsed.data, items };
  const actor = { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) };
  const res = id
    ? await updatePrescription(user.clinicId, id, input)
    : await createPrescription(user.clinicId, input, actor);
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: id ? "update" : "create",
    entity: "patient",
    entityId: input.patientId,
    summary: `${id ? "Updated" : "Added"} a prescription (${items.length} medicine${items.length === 1 ? "" : "s"})`,
  });
  revalidatePath(`/clinic/patients/${input.patientId}`);
  // The id, so "Save & print" can open the new prescription's PDF straight away.
  return { ok: true, id: id ?? ("id" in res ? res.id : undefined) };
}

/** Moves a typed prescription to Trash. `prescriptions:delete`. */
export async function deletePrescriptionAction(id: string, patientId: string): Promise<State> {
  const user = await requireWorkspace();
  if (!can(user, "prescriptions", "delete")) return { error: "You don't have permission to delete prescriptions." };
  const ok = await softDeletePrescription(user.clinicId, id, user.id);
  if (!ok) return { error: "Prescription not found." };
  await logActivity({ action: "delete", entity: "patient", entityId: patientId, summary: "Moved a prescription to Trash" });
  revalidatePath(`/clinic/patients/${patientId}`);
  return { ok: true };
}
