"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { db } from "@/core/db";
import { clinics, users } from "@/core/db/schema";
import { availableSpecialtyIds } from "@/config/modules";

export type AdminActionState = { error?: string; saved?: boolean };

/** True for a Postgres unique-constraint violation (e.g. duplicate email). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

const createClinicSchema = z.object({
  clinicName: z.string().trim().min(2, "Clinic name is required."),
  adminFullName: z.string().trim().min(2, "Admin name is required."),
  adminEmail: z.string().email("Enter a valid admin email."),
  adminPassword: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Creates a clinic with its selected specialties, plus that clinic's first
 * Clinic Admin — the core B2B onboarding action (CLAUDE.md §6, Product decision).
 * Both rows are written in ONE transaction so we never leave a clinic without an
 * admin (or vice-versa).
 *
 * DRIZZLE: straightforward inserts in a transaction — the query builder's job.
 */
export async function createClinicWithAdmin(
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const parsed = createClinicSchema.safeParse({
    clinicName: formData.get("clinicName"),
    adminFullName: formData.get("adminFullName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Only "available" specialties may be enabled; anything else is dropped.
  const allowed = new Set(availableSpecialtyIds());
  const modulesEnabled = formData
    .getAll("modules")
    .map(String)
    .filter((id) => allowed.has(id));

  const email = parsed.data.adminEmail.toLowerCase();
  const passwordHash = await hashPassword(parsed.data.adminPassword);

  let newClinicId: string;
  try {
    newClinicId = await db.transaction(async (tx) => {
      const [clinic] = await tx
        .insert(clinics)
        .values({ name: parsed.data.clinicName, modulesEnabled })
        .returning({ id: clinics.id });

      await tx.insert(users).values({
        clinicId: clinic.id,
        email,
        passwordHash,
        role: "clinic_admin",
        fullName: parsed.data.adminFullName,
      });

      return clinic.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That admin email is already in use." };
    }
    throw err;
  }

  redirect(`/admin/clinics/${newClinicId}`);
}

/**
 * Updates which specialties a clinic has enabled (the module toggles). Writes
 * the validated subset to clinics.modules_enabled.
 */
export async function updateClinicModules(
  clinicId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const allowed = new Set(availableSpecialtyIds());
  const modulesEnabled = formData
    .getAll("modules")
    .map(String)
    .filter((id) => allowed.has(id));

  await db
    .update(clinics)
    .set({ modulesEnabled, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}
