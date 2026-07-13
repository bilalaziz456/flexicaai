"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { clinics, procedures } from "@/core/db/schema";
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
async function requireProcedureAccess(): Promise<{ clinicId: string }> {
  const user = await requireRole(["clinic_admin", "receptionist", "manager"]);
  if (!user.clinicId) redirect("/login?error=no_access");

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) {
    redirect("/login?error=no_access");
  }
  return { clinicId: user.clinicId };
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
  const { clinicId } = await requireProcedureAccess();

  const parsed = procedureSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const [clinic] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const [created] = await db
    .insert(procedures)
    .values({
      clinicId,
      name: parsed.data.name,
      price: parsed.data.price,
      module: clinic?.modulesEnabled?.[0] ?? null,
    })
    .returning({ id: procedures.id });

  await logActivity({
    action: "create",
    entity: "procedure",
    entityId: created.id,
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
  const { clinicId } = await requireProcedureAccess();

  const parsed = procedureSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const isActive = formData.get("isActive") === "on";

  const result = await db
    .update(procedures)
    .set({
      name: parsed.data.name,
      price: parsed.data.price,
      isActive,
      updatedAt: new Date(),
    })
    .where(byClinic(procedures.clinicId, clinicId, eq(procedures.id, procedureId)))
    .returning({ id: procedures.id });
  if (result.length === 0) return { error: "Procedure not found." };

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
  const { clinicId } = await requireProcedureAccess();

  await db
    .delete(procedures)
    .where(byClinic(procedures.clinicId, clinicId, eq(procedures.id, procedureId)));

  await logActivity({
    action: "delete",
    entity: "procedure",
    entityId: procedureId,
    summary: "Deleted a procedure",
  });
  revalidateProcedures();
}

/**
 * One-click import of the enabled specialty's suggested procedures. Skips any
 * whose name the clinic already has (case-insensitive), so it's safe to re-run.
 * Returns how many were added.
 */
export async function importProcedureDefaults(): Promise<ProcedureActionState> {
  const { clinicId } = await requireProcedureAccess();

  const [clinic] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const templates = procedureTemplatesFor(clinic?.modulesEnabled ?? []);
  if (templates.length === 0) return { saved: true };

  const existing = await db
    .select({ name: procedures.name })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId));
  const have = new Set(existing.map((p) => p.name.toLowerCase()));

  const toAdd = templates.filter((t) => !have.has(t.name.toLowerCase()));
  if (toAdd.length === 0) return { saved: true };

  await db.insert(procedures).values(
    toAdd.map((t) => ({
      clinicId,
      name: t.name,
      price: t.price,
      module: clinic?.modulesEnabled?.[0] ?? null,
    })),
  );

  await logActivity({
    action: "create",
    entity: "procedure",
    summary: `Imported ${toAdd.length} default procedure${toAdd.length === 1 ? "" : "s"}`,
  });
  revalidateProcedures();
  return { saved: true };
}
