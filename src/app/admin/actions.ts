"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import {
  appointments,
  clinics,
  doctorLeaves,
  patients,
  procedures,
  recalls,
  sales,
  sessions,
  users,
  visits,
} from "@/core/db/schema";
import { availableSpecialtyIds } from "@/config/modules";
import { CLINIC_FEATURE_IDS } from "@/core/lib/features";
import { backfillClinicSales } from "@/core/sales/ledger";
import { logActivity } from "@/core/audit/log";
import { sanitizeLogAccess } from "@/core/audit/access";
import { USERNAME_REGEX } from "@/core/types/auth";

export type AdminActionState = { error?: string; saved?: boolean };

/** True for a Postgres unique-constraint violation (e.g. duplicate username). */
function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the pg error, so the Postgres code (23505 = unique_violation)
  // may sit on `err` OR on a nested `err.cause`. Walk the cause chain.
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "23505"
    ) {
      return true;
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return false;
}

const createClinicSchema = z.object({
  clinicName: z.string().trim().min(2, "Clinic name is required."),
  adminFullName: z.string().trim().min(2, "Admin name is required."),
  adminUsername: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32, "Username must be at most 32 characters.")
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), {
      message: "Username may use lowercase letters, digits, and . _ - only.",
    }),
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
    adminUsername: formData.get("adminUsername"),
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

  const passwordHash = await hashPassword(parsed.data.adminPassword);

  let newClinicId: string | undefined;
  try {
    await db.transaction(async (tx) => {
      const [clinic] = await tx
        .insert(clinics)
        .values({ name: parsed.data.clinicName, modulesEnabled })
        .returning({ id: clinics.id });
      newClinicId = clinic.id;

      await tx.insert(users).values({
        clinicId: clinic.id,
        username: parsed.data.adminUsername,
        passwordHash,
        role: "clinic_admin",
        fullName: parsed.data.adminFullName,
        // Temp password — force them to set their own on first login.
        mustChangePassword: true,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  await logActivity({
    action: "create",
    entity: "clinic",
    entityId: newClinicId,
    clinicId: newClinicId ?? null,
    summary: `Created clinic “${parsed.data.clinicName}” with admin @${parsed.data.adminUsername}`,
  });
  // Back to the clinics list (refreshed so the new clinic appears immediately)
  // with a flash flag so it can show a success toast.
  revalidatePath("/admin");
  redirect("/admin?created=1");
}

const clinicSettingsSchema = z.object({
  name: z.string().trim().min(2, "Clinic name is required."),
  // How long trashed records stay in the clinic-level Trash (super-admin-set).
  trashRetentionDays: z.coerce
    .number({ message: "Enter a number of days." })
    .int("Whole days only.")
    .min(1, "At least 1 day.")
    .max(3650, "That's too long (max 3650 days)."),
  // Per-clinic WhatsApp SENDER (Meta Cloud API) — provisioned by the super admin.
  whatsappPhoneNumberId: z.string().trim().max(64).optional(),
  whatsappDisplayNumber: z.string().trim().max(32).optional(),
  whatsappSenderName: z.string().trim().max(120).optional(),
});

/**
 * Saves ALL of a clinic's super-admin settings in one call — name, specialties
 * (`modules`), optional features (`features`), and activity-log access
 * (`actions`). Unknown ids in any group are dropped. Only the super admin can
 * change these. Redirects back to the clinics list with a success flash.
 */
export async function updateClinic(
  clinicId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const parsed = clinicSettingsSchema.safeParse({
    name: formData.get("name"),
    trashRetentionDays: formData.get("trashRetentionDays") ?? 30,
    whatsappPhoneNumberId: formData.get("whatsappPhoneNumberId") ?? undefined,
    whatsappDisplayNumber: formData.get("whatsappDisplayNumber") ?? undefined,
    whatsappSenderName: formData.get("whatsappSenderName") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const specialtyAllowed = new Set(availableSpecialtyIds());
  const modulesEnabled = formData
    .getAll("modules")
    .map(String)
    .filter((id) => specialtyAllowed.has(id));

  const featureAllowed = new Set<string>(CLINIC_FEATURE_IDS);
  const featuresEnabled = formData
    .getAll("features")
    .map(String)
    .filter((id) => featureAllowed.has(id));

  const logAccess = sanitizeLogAccess(formData.getAll("actions").map(String));

  // Was the sales feature off before this save? If so, and it's on now, we backfill
  // the ledger below so the report shows history the moment the feature is enabled.
  const [before] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const salesNewlyEnabled =
    featuresEnabled.includes("sales") &&
    !(before?.featuresEnabled ?? []).includes("sales");

  try {
    await db
      .update(clinics)
      .set({
        name: parsed.data.name,
        modulesEnabled,
        featuresEnabled,
        logAccess,
        trashRetentionDays: parsed.data.trashRetentionDays,
        // Per-clinic WhatsApp sender (empty → cleared). phone_number_id is unique
        // across clinics (the inbound routing key) — a duplicate is rejected below.
        whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId || null,
        whatsappDisplayNumber: parsed.data.whatsappDisplayNumber || null,
        whatsappSenderName: parsed.data.whatsappSenderName || null,
        updatedAt: new Date(),
      })
      .where(eq(clinics.id, clinicId));
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === "23505") {
      return { error: "That WhatsApp number id is already assigned to another clinic." };
    }
    throw err;
  }

  // Snapshot sales for the clinic's already-completed appointments (idempotent).
  if (salesNewlyEnabled) {
    await backfillClinicSales(clinicId);
  }

  await logActivity({
    action: "update",
    entity: "clinic",
    entityId: clinicId,
    clinicId,
    summary: `Updated settings for clinic “${parsed.data.name}”`,
  });
  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/admin");
  // Features + log access change what the clinic admin's own panel/nav shows.
  revalidatePath("/clinic", "layout");
  redirect("/admin?updated=1");
}

const updateStaffSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required."),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(32, "Username must be at most 32 characters.")
    .transform((s) => s.toLowerCase())
    .refine((s) => USERNAME_REGEX.test(s), {
      message: "Username may use lowercase letters, digits, and . _ - only.",
    }),
});

/** Edits a staff member's display name and login username. */
export async function updateStaffProfile(
  userId: string,
  _prevState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireRole("super_admin");

  const parsed = updateStaffSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        username: parsed.data.username,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Edited a staff profile (@${parsed.data.username})`,
  });
  revalidatePath("/admin", "layout");
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

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: "Reset a user's password",
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
    const [target] = await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ role: users.role, clinicId: users.clinicId });

    if (!isActive) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }

    // A CLINIC ADMIN's active state cascades to their whole clinic in ONE
    // action: suspending takes the clinic offline (staff suspended + logged
    // out); reactivating brings the whole clinic back (staff re-enabled).
    if (target?.role === "clinic_admin" && target.clinicId) {
      const staff = await tx
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(users.clinicId, target.clinicId),
            inArray(users.role, ["doctor", "receptionist"]),
          ),
        )
        .returning({ id: users.id });
      // Only on suspend do we revoke staff sessions (log them out now).
      if (!isActive) {
        const staffIds = staff.map((s) => s.id);
        if (staffIds.length > 0) {
          await tx.delete(sessions).where(inArray(sessions.userId, staffIds));
        }
      }
    }
  });

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: isActive ? "Reactivated an account" : "Suspended an account",
  });
  // We don't know the clinic id here; refresh the whole admin area.
  revalidatePath("/admin", "layout");
}

/**
 * Trashes a clinic and everything under it. SOFT delete: the clinic + all its
 * live users, patients, appointments, visits, recalls, procedures and doctor
 * leave are marked deleted under one group (children flagged cascade), so Restore
 * reverts exactly this set. All the clinic's sessions are hard-revoked (staff are
 * locked out) and its sale rows voided. Nothing is physically removed — only a
 * super-admin legal purge (Phase 3) can do that. The UI confirms by name.
 */
export async function deleteClinic(
  clinicId: string,
  password: string,
): Promise<AdminActionState> {
  const admin = await requireRole("super_admin");

  // Step-up auth: re-verify the super admin's own password before wiping a clinic.
  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  const group = newDeleteGroup();
  const parent = softDeleteValues(admin.id, group);
  const child = softDeleteValues(admin.id, group, true);

  let notFound = false;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(clinics)
      .set(parent)
      .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
      .returning({ id: clinics.id });
    if (!row) {
      notFound = true;
      return;
    }

    // Cascade-hide every live child row of this clinic.
    await tx.update(users).set(child).where(and(eq(users.clinicId, clinicId), notDeleted(users.deletedAt)));
    await tx.update(patients).set(child).where(and(eq(patients.clinicId, clinicId), notDeleted(patients.deletedAt)));
    await tx.update(appointments).set(child).where(and(eq(appointments.clinicId, clinicId), notDeleted(appointments.deletedAt)));
    await tx.update(visits).set(child).where(and(eq(visits.clinicId, clinicId), notDeleted(visits.deletedAt)));
    await tx.update(recalls).set(child).where(and(eq(recalls.clinicId, clinicId), notDeleted(recalls.deletedAt)));
    await tx.update(procedures).set(child).where(and(eq(procedures.clinicId, clinicId), notDeleted(procedures.deletedAt)));
    await tx.update(doctorLeaves).set(child).where(and(eq(doctorLeaves.clinicId, clinicId), notDeleted(doctorLeaves.deletedAt)));

    // Lock the clinic's staff out (sessions are ephemeral, not trashed) and void
    // its realised-revenue rows (re-backfilled on restore).
    const staff = await tx.select({ id: users.id }).from(users).where(eq(users.clinicId, clinicId));
    const staffIds = staff.map((s) => s.id);
    if (staffIds.length) await tx.delete(sessions).where(inArray(sessions.userId, staffIds));
    await tx.delete(sales).where(eq(sales.clinicId, clinicId));
  });
  if (notFound) return { error: "Clinic not found." };

  await logActivity({
    action: "delete",
    entity: "clinic",
    entityId: clinicId,
    clinicId: null,
    summary: "Moved a clinic and all its data to Trash",
  });
  revalidatePath("/admin");
  redirect("/admin?deleted=1");
}
