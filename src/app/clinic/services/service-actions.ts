"use server";

import {
  createProcedure as createCatalogItem,
  softDeleteProcedure,
  updateProcedure as updateCatalogItem,
} from "@/core/appointments/procedures";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireWorkspace } from "@/core/auth/user";
import type { PermAction } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { logActivity } from "@/core/audit/log";

export type ServiceActionState = { error?: string; saved?: boolean };

/**
 * The SERVICES price list (room, X-ray, dressing, medicines). Behind its own
 * `services` permission — the clinic admin's by default — and, like procedures, only
 * where the super admin has switched the `sales` feature on.
 */
async function requireServiceAccess(action: PermAction) {
  const user = await requireWorkspace("services", action);
  const clinic = await getClinic(user.clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();
  return { user, clinicId: user.clinicId, module: clinic?.modulesEnabled?.[0] ?? null };
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Service name is required.").max(120),
  price: z.coerce
    .number({ message: "Enter a price." })
    .int("Whole rupees only.")
    .min(0, "Price can't be negative.")
    .max(100_000_000, "That's too large."),
});

/** Adds a service to the clinic's price list. */
export async function createService(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  const { clinicId, module } = await requireServiceAccess("create");
  const parsed = serviceSchema.safeParse({ name: formData.get("name"), price: formData.get("price") });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const id = await createCatalogItem(clinicId, { ...parsed.data, module, isService: true });
  await logActivity({
    action: "create",
    entity: "service",
    entityId: id,
    summary: `Added service ${parsed.data.name} (Rs ${parsed.data.price})`,
  });
  revalidatePath("/clinic/services");
  return { saved: true };
}

/** Edits a service's name / price / active flag. Clinic-scoped, services only. */
export async function updateService(
  serviceId: string,
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  const { clinicId } = await requireServiceAccess("edit");
  const parsed = serviceSchema.safeParse({ name: formData.get("name"), price: formData.get("price") });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const isActive = formData.get("isActive") === "on";

  const saved = await updateCatalogItem(clinicId, serviceId, { ...parsed.data, isActive }, "service");
  if (!saved) return { error: "Service not found." };
  await logActivity({
    action: "update",
    entity: "service",
    entityId: serviceId,
    summary: `Updated service ${parsed.data.name} (Rs ${parsed.data.price}${isActive ? "" : ", inactive"})`,
  });
  revalidatePath("/clinic/services");
  return { saved: true };
}

/** Moves a service to Trash. Bills already raised keep their snapshotted line. */
export async function deleteService(serviceId: string): Promise<void> {
  const { user, clinicId } = await requireServiceAccess("delete");
  await softDeleteProcedure(clinicId, serviceId, user.id, "service");
  await logActivity({
    action: "delete",
    entity: "service",
    entityId: serviceId,
    summary: "Moved a service to Trash",
  });
  revalidatePath("/clinic/services");
}
