import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { notifyAppointmentBooked } from "@/core/notifications/appointment";
import { checkDoctorSlot } from "@/core/appointments/availability";
import { parseWhen } from "@/core/appointments/parse-when";

/**
 * True when the inbound text looks like a reschedule request. Triggers on
 * "reschedule"/"postpone", or on move/change/shift when clearly about an
 * appointment (so unrelated "I'll move to Lahore" doesn't fire).
 */
export function isRescheduleIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/reschedul|postpone/.test(t)) return true;
  return (
    /\b(move|change|shift|rebook)\b/.test(t) &&
    /\b(appointment|appt|appointments|booking|slot|visit)\b/.test(t)
  );
}

/** Sends a plain reschedule reply to the patient (logged + best-effort). */
async function reply(
  clinicId: string,
  patientId: string,
  phone: string,
  message: string,
): Promise<void> {
  await sendWhatsAppToPatient({
    clinicId,
    patientId,
    phone,
    campaignName: serverEnv.AISENSY_RESCHEDULE_CAMPAIGN,
    templateParams: [message],
    body: message,
  });
}

export type RescheduleOutcome = {
  handled: boolean;
  rescheduled: boolean;
};

/**
 * Handles a patient's "reschedule …" WhatsApp reply — CORE, clinic-scoped.
 * Finds the patient's next upcoming appointment, parses the new date/time from
 * the message, validates it against the doctor's leave/hours/daily cap (the same
 * `checkDoctorSlot` booking uses), moves the appointment, and confirms — or
 * replies with clear guidance/why it couldn't. Best-effort; never throws.
 */
export async function handleRescheduleReply(args: {
  clinicId: string;
  patientId: string;
  phone: string;
  text: string;
}): Promise<RescheduleOutcome> {
  const { clinicId, patientId, phone, text } = args;
  if (!isRescheduleIntent(text)) return { handled: false, rescheduled: false };

  try {
    const now = new Date();

    // The patient's next upcoming, still-active appointment.
    const [appt] = await db
      .select({
        id: appointments.id,
        doctorId: appointments.doctorId,
        scheduledAt: appointments.scheduledAt,
      })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          and(
            eq(appointments.patientId, patientId),
            inArray(appointments.status, ["scheduled", "confirmed"]),
            gt(appointments.scheduledAt, now),
          ),
        ),
      )
      .orderBy(asc(appointments.scheduledAt))
      .limit(1);

    if (!appt) {
      await reply(
        clinicId,
        patientId,
        phone,
        "You have no upcoming appointment to reschedule. Please contact the clinic to book.",
      );
      return { handled: true, rescheduled: false };
    }

    const parsed = parseWhen(text, now);
    if (!parsed.date) {
      await reply(
        clinicId,
        patientId,
        phone,
        "To reschedule, reply with the new date & time — e.g. \"reschedule 12 Jul 3:00pm\".",
      );
      return { handled: true, rescheduled: false };
    }

    // Missing time → keep the existing appointment's time of day.
    const h = parsed.time ? parsed.time.h : appt.scheduledAt.getHours();
    const min = parsed.time ? parsed.time.min : appt.scheduledAt.getMinutes();
    let when = new Date(parsed.date.y, parsed.date.m - 1, parsed.date.d, h, min, 0, 0);

    // If a bare "12 Jul"-style date lands in the past, assume next year.
    if (!parsed.explicitYear && when.getTime() < now.getTime()) {
      when = new Date(when);
      when.setFullYear(when.getFullYear() + 1);
    }
    if (when.getTime() < now.getTime()) {
      await reply(
        clinicId,
        patientId,
        phone,
        "That time is in the past. Please reply with a future date & time.",
      );
      return { handled: true, rescheduled: false };
    }

    // Validate against the doctor's leave / hours / daily cap (excludes itself).
    if (appt.doctorId) {
      const check = await checkDoctorSlot(clinicId, appt.doctorId, when, {
        excludeAppointmentId: appt.id,
      });
      if (!check.ok) {
        await reply(
          clinicId,
          patientId,
          phone,
          `Couldn't reschedule: ${check.reason} Please reply with another date & time.`,
        );
        return { handled: true, rescheduled: false };
      }
    }

    // Move it. Reset the reminder so the day-before reminder re-sends for the new
    // day; keep it "scheduled" (staff can re-confirm).
    await db
      .update(appointments)
      .set({
        scheduledAt: when,
        status: "scheduled",
        reminderSentAt: null,
        updatedAt: new Date(),
      })
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appt.id)));

    // Confirm with the full details (doctor, hours, fee, new time).
    await notifyAppointmentBooked(clinicId, appt.id);
    return { handled: true, rescheduled: true };
  } catch {
    // Best-effort: an inbound webhook must never fail on a reschedule attempt.
    return { handled: true, rescheduled: false };
  }
}
