"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireClinicAdmin, requireRole } from "@/core/auth/user";
import { can, type PermAction } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { hashPassword } from "@/core/auth/password";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { clinics, patients, sessions, users } from "@/core/db/schema";
import { TIME_RE, timeToMinutes, type DayAvailability } from "@/core/lib/availability";
import { dobFromAgeField } from "@/core/lib/age";
import { logActivity } from "@/core/audit/log";
import { CLINIC_STAFF_ROLES, USERNAME_REGEX } from "@/core/types/auth";
import { sanitizePermissions } from "@/core/auth/permissions";

export type ClinicActionState = { error?: string; saved?: boolean };

/** Drizzle-friendly mutable copy of the manageable-staff role list. */
const STAFF_ROLES = [...CLINIC_STAFF_ROLES];

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
  // A weekday may have several windows (e.g. 09:00–12:00 and 16:00–19:00).
  .max(70);

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
  role: z.enum(CLINIC_STAFF_ROLES),
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
  let createdId: string | undefined;
  try {
    const [created] = await db
      .insert(users)
      .values({
        clinicId,
        username: parsed.data.username,
        passwordHash,
        role: parsed.data.role,
        fullName: parsed.data.fullName,
        mustChangePassword: true,
        // Permissions chosen on the create form (prefilled from role defaults).
        permissions: sanitizePermissions(formData.getAll("perm").map(String)),
        availability,
        flexibleHours,
        dailyAppointmentLimit: dailyLimit,
        consultationFee: fee,
      })
      .returning({ id: users.id });
    createdId = created.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is already in use." };
    }
    throw err;
  }

  await logActivity({
    action: "create",
    entity: "staff",
    entityId: createdId,
    summary: `Added ${parsed.data.role} ${parsed.data.fullName} (@${parsed.data.username})`,
  });
  revalidatePath("/clinic/staff");
  // Land on the list with a flash flag so it can show a success toast.
  redirect("/clinic/staff?created=1");
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

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: isActive ? "Reactivated a staff account" : "Suspended a staff account",
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
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    );

  await logActivity({
    action: "delete",
    entity: "staff",
    entityId: userId,
    summary: "Deleted a staff member",
  });
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

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: "Reset a staff member's password",
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
 * Edits a staff member in ONE save — name + username, plus (for doctors) their
 * working-hours schedule, daily cap, fee and flexible-hours flag. Clinic-scoped
 * and limited to doctors/receptionists, so a clinic admin can never edit another
 * admin (or themselves) through this; a userId from another clinic matches 0
 * rows. (Password reset, suspend, delete and leave stay separate actions.)
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

  // Fetch the (clinic-scoped, editable) member so we know whether to also save a
  // doctor schedule from the same form.
  const [member] = await db
    .select({ role: users.role })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .limit(1);
  if (!member) return { error: "Staff member not found." };

  // Only doctors carry a schedule; a bad schedule blocks the whole save (same as
  // the create form).
  let scheduleValues: {
    availability: DayAvailability[];
    flexibleHours: boolean;
    dailyAppointmentLimit: number;
    consultationFee: number;
  } | null = null;
  if (member.role === "doctor") {
    const schedule = parseDoctorSchedule(formData);
    if ("error" in schedule) return { error: schedule.error };
    scheduleValues = {
      availability: schedule.availability,
      flexibleHours: schedule.flexibleHours,
      dailyAppointmentLimit: schedule.dailyLimit,
      consultationFee: schedule.fee,
    };
  }

  try {
    const result = await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        username: parsed.data.username,
        updatedAt: new Date(),
        ...(scheduleValues ?? {}),
      })
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          and(
            eq(users.id, userId),
            inArray(users.role, STAFF_ROLES),
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

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Edited staff ${parsed.data.fullName} (@${parsed.data.username})`,
  });
  revalidatePath("/clinic/staff");
  revalidatePath(`/clinic/staff/${userId}`);
  // Back to the list with a success flash (matches the create flow).
  redirect("/clinic/staff?updated=1");
}

/**
 * Saves a staff member's per-user permissions (the V/C/E/D grid). Clinic-scoped
 * and limited to manageable staff, so an admin can never touch another clinic's
 * users or themselves. Unknown slugs are dropped; the stored (possibly empty)
 * array replaces the role defaults for that user. Stays on the page (toast).
 */
export async function updateStaffPermissions(
  userId: string,
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const permissions = sanitizePermissions(formData.getAll("perm").map(String));

  const [member] = await db
    .select({ role: users.role, fullName: users.fullName, username: users.username })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .limit(1);
  if (!member) return { error: "Staff member not found." };

  await db
    .update(users)
    .set({ permissions, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    );

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Updated permissions for ${member.fullName ?? member.username}`,
  });
  revalidatePath(`/clinic/staff/${userId}`);
  return { saved: true };
}

/**
 * Resets a staff member's permissions to their role defaults by clearing the
 * override (`permissions` = NULL) — so they follow the role's defaults going
 * forward. Clinic-scoped + manageable staff only. Persists immediately.
 */
export async function resetStaffPermissions(
  userId: string,
): Promise<ClinicActionState> {
  const { clinicId } = await requireClinicAdmin();

  const [member] = await db
    .update(users)
    .set({ permissions: null, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, userId), inArray(users.role, STAFF_ROLES)),
      ),
    )
    .returning({ fullName: users.fullName, username: users.username });
  if (!member) return { error: "Staff member not found." };

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: userId,
    summary: `Reset permissions to role defaults for ${member.fullName ?? member.username}`,
  });
  revalidatePath(`/clinic/staff/${userId}`);
  return { saved: true };
}

const createPatientSchema = z.object({
  fullName: z.string().trim().min(2, "Patient name is required."),
});

/**
 * Patient management is shared by the clinic admin AND any clinic staff granted
 * the `patients` permission (e.g. a doctor). Returns the user + clinic id + which
 * panel's patients base to redirect/revalidate (a doctor lands in /doctor/patients).
 */
async function requirePatientAccess(
  action: PermAction,
): Promise<{ user: CurrentUser; clinicId: string; home: string }> {
  const user = await requireRole(["clinic_admin", "doctor", "receptionist", "manager"]);
  if (!user.clinicId) redirect("/login?error=no_access");
  const home = "/clinic/patients";
  if (!can(user, "patients", action)) redirect(home);
  return { user, clinicId: user.clinicId, home };
}

/** Registers a patient in the caller's clinic. */
export async function createPatient(
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId, home } = await requirePatientAccess("create");

  const parsed = createPatientSchema.safeParse({
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const [createdPatient] = await db
    .insert(patients)
    .values({
      clinicId,
      fullName: parsed.data.fullName,
      phone: emptyToNull(formData.get("phone")),
      email: emptyToNull(formData.get("email")),
      // Patients are entered by age; we store the derived birth date (see age.ts).
      dateOfBirth: dobFromAgeField(formData.get("age")),
      gender: emptyToNull(formData.get("gender")),
      address: emptyToNull(formData.get("address")),
      dataConsent: formData.get("dataConsent") === "on",
    })
    .returning({ id: patients.id });

  await logActivity({
    action: "create",
    entity: "patient",
    entityId: createdPatient.id,
    summary: `Registered patient ${parsed.data.fullName}`,
  });
  revalidatePath(home);
  redirect(`${home}?created=1`);
}

const updatePatientSchema = z.object({
  fullName: z.string().trim().min(2, "Patient name is required."),
});

/** Edits a patient's details — clinic-scoped (a foreign id matches 0 rows). */
export async function updatePatient(
  patientId: string,
  _prevState: ClinicActionState,
  formData: FormData,
): Promise<ClinicActionState> {
  const { clinicId, home } = await requirePatientAccess("edit");

  const parsed = updatePatientSchema.safeParse({
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await db
    .update(patients)
    .set({
      fullName: parsed.data.fullName,
      phone: emptyToNull(formData.get("phone")),
      email: emptyToNull(formData.get("email")),
      dateOfBirth: dobFromAgeField(formData.get("age")),
      gender: emptyToNull(formData.get("gender")),
      address: emptyToNull(formData.get("address")),
      dataConsent: formData.get("dataConsent") === "on",
      updatedAt: new Date(),
    })
    .where(byClinic(patients.clinicId, clinicId, eq(patients.id, patientId)))
    .returning({ id: patients.id });
  if (result.length === 0) return { error: "Patient not found." };

  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: `Edited patient ${parsed.data.fullName}`,
  });
  revalidatePath(home);
  revalidatePath(`${home}/${patientId}`);
  redirect(`${home}?updated=1`);
}

/**
 * Deletes a patient and everything under them (appointments, visits, recalls,
 * whatsapp logs cascade). Clinic-scoped + step-up password. Destructive.
 */
export async function deletePatient(
  patientId: string,
  password: string,
): Promise<ClinicActionState> {
  const { clinicId, home } = await requirePatientAccess("delete");

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await db
    .delete(patients)
    .where(byClinic(patients.clinicId, clinicId, eq(patients.id, patientId)));

  await logActivity({
    action: "delete",
    entity: "patient",
    entityId: patientId,
    summary: "Deleted a patient and their records",
  });
  revalidatePath(home);
  redirect(`${home}?deleted=1`);
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

  await logActivity({
    action: "update",
    entity: "settings",
    summary: `Set average visit value to Rs ${parsed.data.avgVisitValue}`,
  });
  revalidatePath("/clinic");
  return { saved: true };
}
