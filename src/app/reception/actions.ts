"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, count, desc, eq, gte, ilike, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import {
  ACTIVE_APPT_STATUSES,
  availabilityForWeekday,
  dayBounds,
  describeAvailability,
  isDoctorAvailableAt,
  type DayAvailability,
} from "@/core/lib/availability";

export type ReceptionActionState = { error?: string; saved?: boolean };

const APPT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

/**
 * Appointment management is shared by the receptionist AND the clinic admin, so
 * these actions accept either role. The `home` route (where we revalidate and
 * redirect back to) depends on which panel the user came from — sending a clinic
 * admin to /reception would just bounce off the receptionist-only guard.
 */
async function requireAppointmentsAccess(): Promise<{
  clinicId: string;
  home: string;
}> {
  const user = await requireRole(["receptionist", "clinic_admin"]);
  if (!user.clinicId) redirect("/login?error=no_access");
  return {
    clinicId: user.clinicId,
    home: user.role === "clinic_admin" ? "/clinic/appointments" : "/reception",
  };
}

/** Counts a doctor's slot-consuming appointments on the calendar day of `when`. */
async function countDoctorDay(
  clinicId: string,
  doctorId: string,
  when: Date,
): Promise<number> {
  const { start, end } = dayBounds(when);
  const [row] = await db
    .select({ value: count() })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        and(
          eq(appointments.doctorId, doctorId),
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
          inArray(appointments.status, [...ACTIVE_APPT_STATUSES]),
        ),
      ),
    );
  return row?.value ?? 0;
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
  const { clinicId, home } = await requireAppointmentsAccess();

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
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        availability: users.availability,
        dailyLimit: users.dailyAppointmentLimit,
      })
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

    const docName = doc.fullName ?? doc.username;

    // Hard block: the doctor must be working at that day & time.
    if (!isDoctorAvailableAt(doc.availability, when)) {
      const slot = availabilityForWeekday(doc.availability, when.getDay());
      return {
        error: slot
          ? `${docName} works ${slot.start}–${slot.end} that day — pick a time in that window.`
          : `${docName} isn't available then (hours: ${describeAvailability(doc.availability)}).`,
      };
    }

    // Hard block: respect the doctor's daily cap (0 = unlimited).
    if (doc.dailyLimit > 0) {
      const booked = await countDoctorDay(clinicId, doc.id, when);
      if (booked >= doc.dailyLimit) {
        return {
          error: `${docName} is fully booked that day (${booked}/${doc.dailyLimit} appointments).`,
        };
      }
    }
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

  revalidatePath(home);
  redirect(home);
}

/** Advances an appointment's status (confirm / complete / cancel / no-show). */
export async function setAppointmentStatus(
  appointmentId: string,
  status: (typeof APPT_STATUSES)[number],
  _formData: FormData,
): Promise<void> {
  const { clinicId, home } = await requireAppointmentsAccess();
  if (!APPT_STATUSES.includes(status)) return;

  await db
    .update(appointments)
    .set({ status, updatedAt: new Date() })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));

  revalidatePath(home);
}

/** Patient typeahead for the new-appointment picker (clinic-scoped). */
export async function searchClinicPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const { clinicId } = await requireAppointmentsAccess();
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

export type DoctorDaySlots = {
  available: boolean;
  limit: number;
  booked: number;
  remaining: number | null; // null = unlimited
  hours: string | null;
};

/**
 * Live capacity for a doctor on a given date — powers the "appointments left"
 * hint in the scheduling form. `dateStr` is the datetime-local value. Returns a
 * safe "unavailable" shape for an unknown/foreign doctor. Clinic-scoped.
 */
export async function doctorDayAvailability(
  doctorId: string,
  dateStr: string,
): Promise<DoctorDaySlots> {
  const { clinicId } = await requireAppointmentsAccess();
  const when = new Date(dateStr);

  const [doc] = await db
    .select({
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .limit(1);

  if (!doc || Number.isNaN(when.getTime())) {
    return { available: false, limit: 0, booked: 0, remaining: 0, hours: null };
  }

  const avail = (doc.availability ?? []) as DayAvailability[];
  const slot = availabilityForWeekday(avail, when.getDay());
  const available = avail.length === 0 ? true : Boolean(slot);
  const hours = slot
    ? `${slot.start}–${slot.end}`
    : avail.length === 0
      ? "Any time"
      : null;

  const booked = await countDoctorDay(clinicId, doctorId, when);
  const remaining =
    doc.dailyLimit > 0 ? Math.max(0, doc.dailyLimit - booked) : null;

  return { available, limit: doc.dailyLimit, booked, remaining, hours };
}

/**
 * Sets a doctor's daily appointment limit — usable by the receptionist AND the
 * clinic admin (both manage capacity). Clinic-scoped and doctor-only.
 */
export async function setDoctorDailyLimit(
  doctorId: string,
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const { clinicId, home } = await requireAppointmentsAccess();

  const parsed = z.coerce
    .number({ message: "Enter a number." })
    .int("Whole number only.")
    .min(0, "Cannot be negative.")
    .max(500, "That's too large.")
    .safeParse(formData.get("dailyLimit"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid limit." };
  }

  const result = await db
    .update(users)
    .set({ dailyAppointmentLimit: parsed.data, updatedAt: new Date() })
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .returning({ id: users.id });
  if (result.length === 0) return { error: "Doctor not found." };

  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/staff");
  return { saved: true };
}
