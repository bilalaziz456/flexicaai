"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireClinicAdmin } from "@/core/auth/user";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { clinics, patients, sessions, users } from "@/core/db/schema";
import { TIME_RE, timeToMinutes, type DayAvailability } from "@/core/lib/availability";
import { USERNAME_REGEX } from "@/core/types/auth";

export type ClinicActionState = { error?: string; saved?: boolean };

/** Validates the doctor schedule JSON emitted by DoctorScheduleFields. */
const availabilitySchema = z
  .array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        start: z.string().regex(TIME_RE, "Invalid time."),
        end: z.string().regex(TIME_RE, "Invalid time."),
      })
      .refine((d) => (timeToMinutes(d.start) ?? 0) < (timeToMinutes(d.end) ?? 0), {
        message: "End time must be after start time.",
      }),
  )
  .max(7)
  // At most one window per weekday.
  .refine((arr) => new Set(arr.map((a) => a.weekday)).size === arr.length, {
    message: "Duplicate day in schedule.",
  });

const dailyLimitSchema = z.coerce
  .number({ message: "Invalid daily limit." })
  .int("Whole number only.")
  .min(0, "Cannot be negative.")
  .max(500, "That's too large.");

const feeSchema = z.coerce
  .number({ message: "Invalid fee." })
  .int("Whole rupees only.")
  .min(0, "Cannot be negative.")
  .max(10_000_000, "That's too large.");

/**
 * Parses the doctor config fields (working hours + daily limit + fee) from a
 * form. Returns an error string on invalid input, or the parsed values.
 */
function parseDoctorSchedule(
  formData: FormData,
):
  | { error: string }
  | {
      availability: DayAvailability[];
      dailyLimit: number;
      fee: number;
      flexibleHours: boolean;
    } {
  const rawAvail = formData.get("availability");
  let availability: DayAvailability[] = [];
  if (typeof rawAvail === "string" && rawAvail.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(rawAvail);
    } catch {
      return { error: "Invalid schedule." };
    }
    const parsed = availabilitySchema.safeParse(json);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid schedule." };
    }
    availability = parsed.data;
  }

  const limit = dailyLimitSchema.safeParse(formData.get("dailyLimit") ?? 0);
  if (!limit.success) {
    return { error: limit.error.issues[0]?.message ?? "Invalid daily limit." };
  }

  const fee = feeSchema.safeParse(formData.get("fee") ?? 0);
  if (!fee.success) {
    return { error: fee.error.issues[0]?.message ?? "Invalid fee." };
  }

  const flexibleHours = formData.get("flexibleHours") === "true";

  return { availability, dailyLimit: limit.data, fee: fee.data, flexibleHours };
}

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

  // Doctors carry a working-hours schedule + daily cap + fee; receptionists don't.
  let availability: DayAvailability[] = [];
  let dailyLimit = 0;
  let fee = 0;
  let flexibleHours = false;
  if (parsed.data.role === "doctor") {
    const schedule = parseDoctorSchedule(formData);
    if ("error" in schedule) return { error: schedule.error };
    availability = schedule.availability;
    dailyLimit = schedule.dailyLimit;
    fee = schedule.fee;
    flexibleHours = schedule.flexibleHours;
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
      availability,
      flexibleHours,
      dailyAppointmentLimit: dailyLimit,
      consultationFee: fee,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  revalidatePath("/clinic/staff");
  redirect("/clinic/staff");
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

  // "layout" scope refreshes both the list and the staff detail page.
  revalidatePath("/clinic/staff", "layout");
}

/**
 * Permanently deletes a staff member — clinic-scoped and limited to doctors/
 * receptionists (a clinic admin can never delete another admin or themselves).
 * Their sessions cascade away; their appointments/visits are kept but their
 * doctor reference is set null, so clinical history is preserved.
 */
export async function deleteStaff(
  userId: string,
  password: string,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  // Step-up auth: re-verify the admin's own password before deleting.
  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await db
    .delete(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), inArray(users.role, ["doctor", "receptionist"])),
      ),
    );

  // Deletion happens from the staff detail page — leave it (the record is gone).
  revalidatePath("/clinic/staff");
  redirect("/clinic/staff");
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

/**
 * Edits a staff member's name + username — clinic-scoped and limited to
 * doctors/receptionists, so a clinic admin can never rename another admin (or
 * themselves) through this. A userId from another clinic matches 0 rows.
 */
export async function updateStaffProfile(
  userId: string,
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = updateStaffSchema.safeParse({
    fullName: formData.get("fullName"),
    username: formData.get("username"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        username: parsed.data.username,
        updatedAt: new Date(),
      })
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          and(
            eq(users.id, userId),
            inArray(users.role, ["doctor", "receptionist"]),
          ),
        ),
      )
      .returning({ id: users.id });
    if (result.length === 0) return { error: "Staff member not found." };
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
 * Edits a doctor's working-hours schedule + daily appointment limit. Clinic-
 * scoped and limited to role = doctor, so a crafted id from another clinic or a
 * non-doctor matches 0 rows.
 */
export async function updateDoctorSchedule(
  userId: string,
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const schedule = parseDoctorSchedule(formData);
  if ("error" in schedule) return { error: schedule.error };

  const result = await db
    .update(users)
    .set({
      availability: schedule.availability,
      flexibleHours: schedule.flexibleHours,
      dailyAppointmentLimit: schedule.dailyLimit,
      consultationFee: schedule.fee,
      updatedAt: new Date(),
    })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), eq(users.role, "doctor")),
      ),
    )
    .returning({ id: users.id });
  if (result.length === 0) return { error: "Doctor not found." };

  revalidatePath("/clinic/staff");
  revalidatePath(`/clinic/staff/${userId}`);
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
  redirect("/clinic/patients");
}

const clinicSettingsSchema = z.object({
  avgVisitValue: z.coerce
    .number({ message: "Enter a number." })
    .int("Whole rupees only.")
    .min(0, "Cannot be negative.")
    .max(100_000_000, "That's too large."),
});

/** Owner setting: average revenue per visit — drives the "Revenue Recovered" metric. */
export async function updateClinicSettings(
  _prev: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const parsed = clinicSettingsSchema.safeParse({
    avgVisitValue: formData.get("avgVisitValue"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db
    .update(clinics)
    .set({ avgVisitValue: parsed.data.avgVisitValue, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  revalidatePath("/clinic");
  return { saved: true };
}
