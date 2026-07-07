"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";

export type ReceptionActionState = { error?: string; saved?: boolean };

const APPT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

async function requireReceptionClinic(): Promise<string> {
  const user = await requireRole("receptionist");
  if (!user.clinicId) redirect("/login?error=no_access");
  return user.clinicId;
}

const createSchema = z.object({
  patientId: z.string().uuid("Choose a patient."),
  doctorId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
      message: "Invalid doctor.",
    }),
  scheduledAt: z.string().min(1, "Pick a date & time."),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  reason: z.string().trim().optional(),
});

/** Schedules an appointment in the receptionist's clinic. */
export async function createAppointment(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const clinicId = await requireReceptionClinic();

  const parsed = createSchema.safeParse({
    patientId: formData.get("patientId"),
    doctorId: formData.get("doctorId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date & time." };

  // Tenant guards: patient (and doctor, if set) must belong to this clinic.
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, parsed.data.patientId), eq(patients.clinicId, clinicId)))
    .limit(1);
  if (!patient) return { error: "Patient not found." };

  if (parsed.data.doctorId) {
    const [doc] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          and(eq(users.id, parsed.data.doctorId), eq(users.role, "doctor")),
        ),
      )
      .limit(1);
    if (!doc) return { error: "Doctor not found." };
  }

  // Tag the appointment with the clinic's first enabled module (if any).
  const [clinic] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  await db.insert(appointments).values({
    clinicId,
    patientId: parsed.data.patientId,
    doctorId: parsed.data.doctorId ?? null,
    module: clinic?.modulesEnabled?.[0] ?? null,
    scheduledAt: when,
    durationMinutes: parsed.data.durationMinutes,
    reason: parsed.data.reason ?? null,
  });

  revalidatePath("/reception");
  redirect("/reception");
}

/** Advances an appointment's status (confirm / complete / cancel / no-show). */
export async function setAppointmentStatus(
  appointmentId: string,
  status: (typeof APPT_STATUSES)[number],
  _formData: FormData,
): Promise<void> {
  const clinicId = await requireReceptionClinic();
  if (!APPT_STATUSES.includes(status)) return;

  await db
    .update(appointments)
    .set({ status, updatedAt: new Date() })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));

  revalidatePath("/reception");
}

/** Patient typeahead for the new-appointment picker (clinic-scoped). */
export async function searchClinicPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const clinicId = await requireReceptionClinic();
  const q = query.trim();

  return db
    .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
    .from(patients)
    .where(
      q
        ? and(
            eq(patients.clinicId, clinicId),
            or(ilike(patients.fullName, `%${q}%`), ilike(patients.phone, `%${q}%`)),
          )
        : eq(patients.clinicId, clinicId),
    )
    .orderBy(desc(patients.createdAt))
    .limit(20);
}
