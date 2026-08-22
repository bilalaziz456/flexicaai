"use server";

import {
  addMissingProcedures,
  createProcedure as createProcedureRecord,
  softDeleteProcedure,
  updateProcedure as updateProcedureRecord,
} from "@/core/appointments/procedures";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { procedureTemplatesFor } from "@/config/modules";
import { logActivity } from "@/core/audit/log";

export type ProcedureActionState = { error?: string; saved?: boolean };

/**
 * The procedure catalog is managed by BOTH the clinic admin AND the
 * receptionist (front-desk owns booking), so these actions accept either role.
 * Access also requires the clinic to have the `sales` feature switched on by the
 * super admin. Returns the clinic id + which panel to revalidate.
 */
async function requireProcedureAccess(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string }> {
  const user = await requireRole(["clinic_admin", "receptionist", "manager"]);
  if (!user.clinicId) redirect("/login?error=no_access");

  const clinic = await getClinic(user.clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) {
    redirect("/login?error=no_access");
  }
  // Per-user permission on top of the role + feature gate.
  if (!can(user, "procedures", action)) {
    redirect(user.role === "clinic_admin" ? "/clinic/procedures" : "/reception/procedures");
  }
  return { user, clinicId: user.clinicId };
}

/** Both panels host the catalog — keep them both fresh after a change. */
function revalidateProcedures() {
  revalidatePath("/clinic/procedures");
  revalidatePath("/reception/procedures");
}

const procedureSchema = z.object({
  name: z.string().trim().min(2, "Procedure name is required.").max(120),
  price: z.coerce
    .number({ message: "Enter a price." })
    .int("Whole rupees only.")
    .min(0, "Price can't be negative.")
    .max(100_000_000, "That's too large."),
});

/** Adds a procedure to the clinic's catalog. */
export async function createProcedure(
  _prev: ProcedureActionState,
  formData: FormData,
): Promise<ProcedureActionState> {
  const { clinicId } = await requireProcedureAccess("create");

  const parsed = procedureSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const clinic = await getClinic(clinicId);

  const createdId = await createProcedureRecord(clinicId, {
    name: parsed.data.name,
    price: parsed.data.price,
    module: clinic?.modulesEnabled?.[0] ?? null,
  });

  await logActivity({
    action: "create",
    entity: "procedure",
    entityId: createdId,
    summary: `Added procedure ${parsed.data.name} (Rs ${parsed.data.price})`,
  });
  revalidateProcedures();
  return { saved: true };
}

/** Edits a procedure's name / price / active flag. Clinic-scoped. */
export async function updateProcedure(
  procedureId: string,
  _prev: ProcedureActionState,
  formData: FormData,
): Promise<ProcedureActionState> {
  const { clinicId } = await requireProcedureAccess("edit");

  const parsed = procedureSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }
  const isActive = formData.get("isActive") === "on";

  const saved = await updateProcedureRecord(clinicId, procedureId, {
    name: parsed.data.name,
    price: parsed.data.price,
    isActive,
  });
  if (!saved) return { error: "Procedure not found." };

  await logActivity({
    action: "update",
    entity: "procedure",
    entityId: procedureId,
    summary: `Updated procedure ${parsed.data.name} (Rs ${parsed.data.price}${isActive ? "" : ", inactive"})`,
  });
  revalidateProcedures();
  return { saved: true };
}

/**
 * Deletes a procedure. Historical appointment line items snapshot the name +
 * price, so removing it here never rewrites past sales. Clinic-scoped.
 */
export async function deleteProcedure(procedureId: string): Promise<void> {
  const { user, clinicId } = await requireProcedureAccess("delete");

  await softDeleteProcedure(clinicId, procedureId, user.id);

  await logActivity({
    action: "delete",
    entity: "procedure",
    entityId: procedureId,
    summary: "Moved a procedure to Trash",
  });
  revalidateProcedures();
}

/**
 * One-click import of the enabled specialty's suggested procedures. Skips any
 * whose name the clinic already has (case-insensitive), so it's safe to re-run.
 * Returns how many were added.
 */
export async function importProcedureDefaults(): Promise<ProcedureActionState> {
  const { clinicId } = await requireProcedureAccess("create");

  const clinic = await getClinic(clinicId);

  const templates = procedureTemplatesFor(clinic?.modulesEnabled ?? []);
  if (templates.length === 0) return { saved: true };

  const added = await addMissingProcedures(
    clinicId,
    templates,
    clinic?.modulesEnabled?.[0] ?? null,
  );
  if (added === 0) return { saved: true };

  await logActivity({
    action: "create",
    entity: "procedure",
    summary: `Imported ${added} default procedure${added === 1 ? "" : "s"}`,
  });
  revalidateProcedures();
  return { saved: true };
}
