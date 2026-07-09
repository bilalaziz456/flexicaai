import "server-only";

import { and, inArray, eq, isNotNull } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";

/** "Mon 12 Jul, 10:00" — the appointment time for the patient message. */
function formatWhen(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Best-effort WhatsApp notice to patients that their appointment was cancelled,
 * with the doctor's name and the appointment time. CORE, clinic-scoped. Only
 * appointments whose patient has a phone are messaged. Sends via the standard
 * channel (which logs every attempt and no-ops gracefully when WhatsApp is
 * unconfigured), and NEVER throws — a notification failure must not undo or
 * block the cancellation that triggered it.
 *
 * Template params order (map these in the AiSensy "appointment_cancelled"
 * template): {{1}} patient name, {{2}} doctor, {{3}} date & time, {{4}} clinic.
 */
export async function notifyAppointmentsCancelled(
  clinicId: string,
  appointmentIds: string[],
): Promise<void> {
  if (appointmentIds.length === 0) return;

  try {
    const rows = await db
      .select({
        patientId: patients.id,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        scheduledAt: appointments.scheduledAt,
        doctorName: users.fullName,
        doctorUsername: users.username,
        clinicName: clinics.name,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .innerJoin(clinics, eq(appointments.clinicId, clinics.id))
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          and(
            inArray(appointments.id, appointmentIds),
            isNotNull(patients.phone),
          ),
        ),
      );

    for (const r of rows) {
      if (!r.patientPhone) continue;
      const doctor = r.doctorName ?? r.doctorUsername ?? "your doctor";
      const when = formatWhen(r.scheduledAt);
      await sendWhatsAppToPatient({
        clinicId,
        patientId: r.patientId,
        phone: r.patientPhone,
        campaignName: serverEnv.AISENSY_CANCEL_CAMPAIGN,
        userName: r.patientName,
        templateParams: [r.patientName, doctor, when, r.clinicName],
        body: `Your appointment with ${doctor} on ${when} has been cancelled.`,
      });
    }
  } catch {
    // Best-effort: never let a notification error affect the cancellation.
  }
}
