"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { db } from "@/core/db";
import { clinics, sessions, users } from "@/core/db/schema";
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
        // Temp password — force them to set their own on first login.
        mustChangePassword: true,
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

const renameSchema = z.object({
  name: z.string().trim().min(2, "Clinic name is required."),
});

/** Renames a clinic. */
export async function updateClinicName(
  clinicId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const parsed = renameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db
    .update(clinics)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  return { saved: true };
}

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Resets a user's password to a new temporary one and forces them to change it
 * on next login. Also revokes their existing sessions so the old password (and
 * any active session) can no longer be used.
 */
export async function resetUserPassword(
  userId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  return { saved: true };
}

/**
 * Suspends or reactivates an account. Suspending also revokes active sessions so
 * access is cut immediately (a disabled user also fails getSessionUser's check).
 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
  _formData: FormData,
): Promise<void> {
  await requireRole("super_admin");

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, userId));
    if (!isActive) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
  });

  // We don't know the clinic id here; refresh the whole admin area.
  revalidatePath("/admin", "layout");
}

/**
 * Deletes a clinic and everything under it. Users are removed explicitly first
 * (their sessions cascade); deleting the clinic then cascades patients,
 * appointments, visits and recalls. Destructive — the UI confirms by name.
 */
export async function deleteClinic(
  clinicId: string,
  _formData: FormData,
): Promise<void> {
  await requireRole("super_admin");

  await db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.clinicId, clinicId));
    await tx.delete(clinics).where(eq(clinics.id, clinicId));
  });

  revalidatePath("/admin");
  redirect("/admin");
}
