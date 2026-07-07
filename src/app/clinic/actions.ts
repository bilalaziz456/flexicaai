"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireClinicAdmin } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients, sessions, users } from "@/core/db/schema";
import { USERNAME_REGEX } from "@/core/types/auth";

export type ClinicActionState = { error?: string; saved?: boolean };

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

const emptyToNull = (v: FormDataEntryValue | null): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

const createStaffSchema = z.object({
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
  // A clinic admin can only create clinical/front-desk staff — never admins.
  role: z.enum(["doctor", "receptionist"]),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/** Creates a doctor or receptionist inside the admin's own clinic. */
export async function createStaff(
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = createStaffSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await db.insert(users).values({
      clinicId,
      username: parsed.data.username,
      passwordHash,
      role: parsed.data.role,
      fullName: parsed.data.fullName,
      mustChangePassword: true,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  revalidatePath("/clinic/staff");
  return { saved: true };
}

/**
 * Suspends/reactivates a staff member — only within the admin's clinic. The
 * clinic_id condition means a crafted userId from another clinic matches 0 rows.
 */
export async function setStaffActive(
  userId: string,
  isActive: boolean,
  _formData: FormData,
): Promise<void> {
  const { clinicId } = await requireClinicAdmin();

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(byClinic(users.clinicId, clinicId, eq(users.id, userId)));
    if (!isActive) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
  });

  revalidatePath("/clinic/staff");
}

const resetStaffSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/** Resets a staff member's password to a temp one (clinic-scoped) + forces change. */
export async function resetStaffPassword(
  userId: string,
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = resetStaffSchema.safeParse({
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
      .where(byClinic(users.clinicId, clinicId, eq(users.id, userId)));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  revalidatePath("/clinic/staff");
  return { saved: true };
}

const createPatientSchema = z.object({
  fullName: z.string().trim().min(2, "Patient name is required."),
});

/** Registers a patient in the admin's clinic. */
export async function createPatient(
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = createPatientSchema.safeParse({
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.insert(patients).values({
    clinicId,
    fullName: parsed.data.fullName,
    phone: emptyToNull(formData.get("phone")),
    email: emptyToNull(formData.get("email")),
    dateOfBirth: emptyToNull(formData.get("dateOfBirth")),
    gender: emptyToNull(formData.get("gender")),
    address: emptyToNull(formData.get("address")),
    dataConsent: formData.get("dataConsent") === "on",
  });

  revalidatePath("/clinic/patients");
  return { saved: true };
}
