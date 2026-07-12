"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, ilike, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/core/auth/user";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import {
  appointments,
  clinics,
  doctorLeaves,
  patients,
  users,
} from "@/core/db/schema";
import {
  windowsForWeekday,
  type DayAvailability,
} from "@/core/lib/availability";
import {
  checkDoctorSlot,
  countDoctorDay,
  dateFromStr,
  doctorOnLeave,
  localDateStr,
} from "@/core/appointments/availability";
import { queueSessionKey, withQueueNumber } from "@/core/appointments/queue";
import {
  saveAppointmentProcedures,
  type ProcedureSelection,
} from "@/core/appointments/procedures";
import {
  recordSaleForAppointment,
  voidSaleForAppointment,
} from "@/core/sales/ledger";
import {
  notifyAppointmentBooked,
  notifyAppointmentsCancelled,
} from "@/core/notifications/appointment";
import { logActivity } from "@/core/audit/log";

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
  discountType: z.enum(["amount", "percent"]).default("amount"),
  discountValue: z.coerce.number().int().min(0, "Discount can't be negative.").default(0),
});

/**
 * Discounts are validated against their type: a percentage can't exceed 100
 * (an amount is free — the fee itself clamps the net). Returns an error string
 * or null. Shared by create + update so the rule can't drift.
 */
function validateDiscount(type: "amount" | "percent", value: number): string | null {
  if (type === "percent" && value > 100) return "Percentage can't exceed 100.";
  return null;
}

/**
 * The booking form submits one hidden `procedure` field per chosen procedure,
 * encoded `"<procedureId>:<quantity>"`. Parse them into selections (the data
 * layer clamps/merges + validates ids against the clinic's catalog).
 */
function parseProcedureSelections(formData: FormData): ProcedureSelection[] {
  return formData
    .getAll("procedure")
    .map(String)
    .map((raw) => {
      const [procedureId, qty] = raw.split(":");
      return { procedureId, quantity: Number(qty) || 1 };
    })
    .filter((s) => s.procedureId);
}

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
    discountType: formData.get("discountType") ?? undefined,
    discountValue: formData.get("discountValue"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const discountError = validateDiscount(
    parsed.data.discountType,
    parsed.data.discountValue,
  );
  if (discountError) return { error: discountError };

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date & time." };

  // Procedure-only visits don't charge the consultation fee (checkbox off → "0").
  const chargeConsultation = formData.get("chargeConsultation") !== "0";

  // Tenant guards: patient (and doctor, if set) must belong to this clinic.
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, parsed.data.patientId), eq(patients.clinicId, clinicId)))
    .limit(1);
  if (!patient) return { error: "Patient not found." };

  // Queue context comes from the slot check so we don't re-query the schedule.
  let queueAvailability: DayAvailability[] = [];
  let queueFlexible = false;
  if (parsed.data.doctorId) {
    // Single source of truth for leave / working hours / daily cap.
    const check = await checkDoctorSlot(clinicId, parsed.data.doctorId, when);
    if (!check.ok) return { error: check.reason };
    queueAvailability = check.availability;
    queueFlexible = check.flexible;
  }

  // Tag the appointment with the clinic's first enabled module (if any).
  const [clinic] = await db
    .select({ modulesEnabled: clinics.modulesEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  // Assign the patient's queue token within the doctor's window session.
  const [created] = await withQueueNumber(
    {
      clinicId,
      doctorId: parsed.data.doctorId ?? null,
      when,
      availability: queueAvailability,
      flexible: queueFlexible,
    },
    (q) =>
      db
        .insert(appointments)
        .values({
          clinicId,
          patientId: parsed.data.patientId,
          doctorId: parsed.data.doctorId ?? null,
          module: clinic?.modulesEnabled?.[0] ?? null,
          scheduledAt: when,
          durationMinutes: parsed.data.durationMinutes,
          reason: parsed.data.reason ?? null,
          discountType: parsed.data.discountType,
          discountValue: parsed.data.discountValue,
          chargeConsultation,
          queueSession: q.queueSession,
          queueNumber: q.queueNumber,
        })
        .returning({ id: appointments.id }),
  );

  // Attach the selected procedures (snapshotted prices) before notifying, so the
  // confirmation quotes the full total.
  await saveAppointmentProcedures(
    clinicId,
    created.id,
    parseProcedureSelections(formData),
  );

  // Confirm to the patient over WhatsApp (doctor, hours, fee, time).
  await notifyAppointmentBooked(clinicId, created.id);

  await logActivity({
    action: "create",
    entity: "appointment",
    entityId: created.id,
    summary: `Scheduled an appointment for ${when.toLocaleString("en-GB")}`,
  });
  revalidatePath(home);
  // Land on the list with a flash flag so it can show a success toast.
  redirect(`${home}?created=1`);
}

const updateSchema = z.object({
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
  discountType: z.enum(["amount", "percent"]).default("amount"),
  discountValue: z.coerce.number().int().min(0, "Discount can't be negative.").default(0),
});

/** Edits an existing appointment (doctor / date-time / duration / reason / discount). */
export async function updateAppointment(
  appointmentId: string,
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const { clinicId, home } = await requireAppointmentsAccess();

  const parsed = updateSchema.safeParse({
    doctorId: formData.get("doctorId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    reason: formData.get("reason"),
    discountType: formData.get("discountType") ?? undefined,
    discountValue: formData.get("discountValue"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const discountError = validateDiscount(
    parsed.data.discountType,
    parsed.data.discountValue,
  );
  if (discountError) return { error: discountError };

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date & time." };

  const [appt] = await db
    .select({
      id: appointments.id,
      queueSession: appointments.queueSession,
      status: appointments.status,
    })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  if (!appt) return { error: "Appointment not found." };

  let queueAvailability: DayAvailability[] = [];
  let queueFlexible = false;
  if (parsed.data.doctorId) {
    // Same leave / hours / cap enforcement as booking (excludes this appt).
    const check = await checkDoctorSlot(clinicId, parsed.data.doctorId, when, {
      excludeAppointmentId: appointmentId,
    });
    if (!check.ok) return { error: check.reason };
    queueAvailability = check.availability;
    queueFlexible = check.flexible;
  }

  const where = byClinic(
    appointments.clinicId,
    clinicId,
    eq(appointments.id, appointmentId),
  );
  const baseSet = {
    doctorId: parsed.data.doctorId ?? null,
    scheduledAt: when,
    durationMinutes: parsed.data.durationMinutes,
    reason: parsed.data.reason ?? null,
    discountType: parsed.data.discountType,
    discountValue: parsed.data.discountValue,
    chargeConsultation: formData.get("chargeConsultation") !== "0",
    reminderSentAt: null, // time may have changed → re-send the reminder
    updatedAt: new Date(),
  };

  // Which queue session does the appointment belong to after this edit?
  const newSession = parsed.data.doctorId
    ? queueSessionKey(parsed.data.doctorId, when, queueAvailability, queueFlexible)
    : null;

  if (newSession === appt.queueSession) {
    // Same window (or still no doctor) → keep the existing token number.
    await db.update(appointments).set(baseSet).where(where);
  } else if (!parsed.data.doctorId) {
    // Moved to "Any doctor" → drop the token.
    await db
      .update(appointments)
      .set({ ...baseSet, queueSession: null, queueNumber: null })
      .where(where);
  } else {
    // Moved to a different doctor/window → issue a fresh token there.
    await withQueueNumber(
      {
        clinicId,
        doctorId: parsed.data.doctorId,
        when,
        availability: queueAvailability,
        flexible: queueFlexible,
      },
      (q) =>
        db
          .update(appointments)
          .set({ ...baseSet, queueSession: q.queueSession, queueNumber: q.queueNumber })
          .where(where),
    );
  }

  // Replace the appointment's procedure line items with the current selection.
  await saveAppointmentProcedures(
    clinicId,
    appointmentId,
    parseProcedureSelections(formData),
  );

  // If this appointment is already completed, its sale is on the books — re-snapshot
  // it so the edit (doctor/fee, procedures, discount) flows through to the report.
  if (appt.status === "completed") {
    await recordSaleForAppointment(clinicId, appointmentId);
  }

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Edited an appointment (now ${when.toLocaleString("en-GB")})`,
  });
  revalidatePath(home);
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidatePath(`/reception/appointments/${appointmentId}`);
  // Redirect back to the list (not stay on the edit form) so React 19's
  // post-action form reset can't blank the controlled fields, and show a
  // success toast there via the flash flag.
  redirect(`${home}?updated=1`);
}

/** Permanently deletes an appointment (step-up password). Clinic-scoped. */
export async function deleteAppointment(
  appointmentId: string,
  password: string,
): Promise<ReceptionActionState> {
  const { clinicId, home } = await requireAppointmentsAccess();

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await db
    .delete(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));

  await logActivity({
    action: "delete",
    entity: "appointment",
    entityId: appointmentId,
    summary: "Deleted an appointment",
  });
  revalidatePath(home);
  redirect(home);
}

/**
 * Sets an appointment's status to any value (a dropdown, so it supports undo —
 * e.g. confirmed → scheduled). Patient notices fire only on an actual TRANSITION
 * into a status (guarded by the prior status), never on re-selecting the same one.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status: (typeof APPT_STATUSES)[number],
): Promise<void> {
  const { clinicId, home } = await requireAppointmentsAccess();
  if (!APPT_STATUSES.includes(status)) return;

  // Source + prior status decide whether/what to message the patient.
  const [prior] = await db
    .select({ source: appointments.source, status: appointments.status })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  if (!prior || prior.status === status) return; // nothing to change

  await db
    .update(appointments)
    .set({ status, updatedAt: new Date() })
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)));

  if (status === "cancelled") {
    // Tell the patient (with doctor + time) their appointment is cancelled.
    await notifyAppointmentsCancelled(clinicId, [appointmentId]);
  } else if (status === "confirmed" && prior.source === "whatsapp") {
    // A WhatsApp self-booking is confirmed by staff → send the confirmation
    // (slot, timing, doctor, fee).
    await notifyAppointmentBooked(clinicId, appointmentId);
  }

  // Sales ledger: a completed appointment is a realised sale; leaving "completed"
  // (e.g. an accidental mark, or moved back to scheduled) voids it. Best-effort —
  // never blocks the status change.
  if (status === "completed") {
    await recordSaleForAppointment(clinicId, appointmentId);
  } else if (prior.status === "completed") {
    await voidSaleForAppointment(clinicId, appointmentId);
  }

  await logActivity({
    action: "status",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Marked an appointment ${status.replace("_", " ")}`,
  });
  revalidatePath(home);
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidatePath(`/reception/appointments/${appointmentId}`);
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
  onLeave: boolean;
  flexible: boolean;
  /** The doctor's working windows on the selected date (empty when flexible/off). */
  windows: { start: string; end: string }[];
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
      flexibleHours: users.flexibleHours,
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
    return {
      available: false,
      onLeave: false,
      flexible: false,
      windows: [],
      limit: 0,
      booked: 0,
      remaining: 0,
      hours: null,
    };
  }

  // Leave overrides everything: a doctor on leave is unavailable that day.
  const onLeave = await doctorOnLeave(clinicId, doctorId, localDateStr(when));

  const avail = (doc.availability ?? []) as DayAvailability[];
  const flexible = doc.flexibleHours;
  const windows = flexible
    ? []
    : windowsForWeekday(avail, when.getDay()).map((w) => ({
        start: w.start,
        end: w.end,
      }));
  // Flexible doctors are bookable any time; otherwise the day must have windows.
  const availableByHours = flexible ? true : windows.length > 0;
  const available = !onLeave && availableByHours;
  const hours = flexible
    ? "Any time"
    : windows.length
      ? windows.map((w) => `${w.start}–${w.end}`).join(", ")
      : null;

  const booked = await countDoctorDay(clinicId, doctorId, when);
  const remaining =
    doc.dailyLimit > 0 ? Math.max(0, doc.dailyLimit - booked) : null;

  return { available, onLeave, flexible, windows, limit: doc.dailyLimit, booked, remaining, hours };
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

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: doctorId,
    summary: `Set a doctor's daily appointment limit to ${parsed.data}`,
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/staff");
  return { saved: true };
}

export type LeaveActionState = {
  error?: string;
  saved?: boolean;
  cancelled?: number;
};

const leaveSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });

/**
 * Marks a doctor on leave/vacation for a date range — usable by the receptionist
 * AND the clinic admin. Any active (scheduled/confirmed) appointments for that
 * doctor within the range are CANCELLED, since the doctor won't be in. Returns
 * how many were cancelled. Clinic-scoped and doctor-only.
 */
export async function addDoctorLeave(
  doctorId: string,
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const { clinicId, home } = await requireAppointmentsAccess();

  const parsed = leaveSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: (formData.get("reason") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid dates." };
  }

  const [doc] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        and(eq(users.id, doctorId), eq(users.role, "doctor")),
      ),
    )
    .limit(1);
  if (!doc) return { error: "Doctor not found." };

  let cancelledIds: string[] = [];
  await db.transaction(async (tx) => {
    await tx.insert(doctorLeaves).values({
      clinicId,
      doctorId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason ?? null,
    });

    // Cancel active appointments within [start, end] (inclusive of the last day).
    const start = dateFromStr(parsed.data.startDate);
    const end = dateFromStr(parsed.data.endDate);
    end.setDate(end.getDate() + 1); // exclusive upper bound
    const cancelledRows = await tx
      .update(appointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          and(
            eq(appointments.doctorId, doctorId),
            inArray(appointments.status, ["scheduled", "confirmed"]),
            gte(appointments.scheduledAt, start),
            lt(appointments.scheduledAt, end),
          ),
        ),
      )
      .returning({ id: appointments.id });
    cancelledIds = cancelledRows.map((r) => r.id);
  });

  // Notify affected patients (doctor + time) after the cancellations commit.
  if (cancelledIds.length > 0) {
    await notifyAppointmentsCancelled(clinicId, cancelledIds);
  }

  await logActivity({
    action: "create",
    entity: "leave",
    entityId: doctorId,
    summary: `Set doctor leave ${parsed.data.startDate}→${parsed.data.endDate}${cancelledIds.length ? ` (${cancelledIds.length} appt(s) cancelled)` : ""}`,
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/staff", "layout");
  return { saved: true, cancelled: cancelledIds.length };
}

/** Removes a leave entry (does not restore already-cancelled appointments). */
export async function removeDoctorLeave(
  leaveId: string,
  _formData: FormData,
): Promise<void> {
  const { clinicId, home } = await requireAppointmentsAccess();

  await db
    .delete(doctorLeaves)
    .where(byClinic(doctorLeaves.clinicId, clinicId, eq(doctorLeaves.id, leaveId)));

  await logActivity({
    action: "delete",
    entity: "leave",
    entityId: leaveId,
    summary: "Removed a doctor leave entry",
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/staff", "layout");
}
