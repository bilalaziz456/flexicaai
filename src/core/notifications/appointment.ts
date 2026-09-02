import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import { billFromTotals, effectiveDiscountValue } from "@/core/appointments/fee";
import {
  appointmentProcedureNamesSql,
  appointmentProceduresGrossSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { report } from "@/core/observability";

/** "Rs 1,500" or "Not specified" for a 0/absent fee. */
function formatFee(fee: number | null): string {
  return fee && fee > 0
    ? `Rs ${new Intl.NumberFormat("en-PK").format(fee)}`
    : "Not specified";
}

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
        doctorPrefix: users.prefix,
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
      const doctor = displayStaffName(
        r.doctorPrefix,
        r.doctorName,
        r.doctorUsername ?? "your doctor",
      );
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
  } catch (e) {
    // Best-effort: never let a notification error affect the cancellation. But the
    // patient was NOT told, so staff may need to ring them — worth surfacing.
    report(e, { op: "notifications.appointmentsCancelled", clinicId });
  }
}

/**
 * Best-effort WhatsApp confirmation to a patient that their appointment is
 * booked — with the doctor's name, working hours, and consultation fee, plus the
 * date & time. CORE, clinic-scoped, only messages a patient with a phone, and
 * never throws (a notify failure must not block the booking).
 *
 * Template params order (map these in the "appointment_booked" template):
 * {{1}} patient, {{2}} doctor, {{3}} date & time, {{4}} fee, {{5}} clinic,
 * {{6}} queue token (e.g. "#3", empty if none). The message states only the
 * appointment's own day/date/time — NOT the doctor's full weekly hours.
 */
export async function notifyAppointmentBooked(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    const [r] = await db
      .select({
        patientId: patients.id,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        scheduledAt: appointments.scheduledAt,
        doctorName: users.fullName,
        doctorUsername: users.username,
        doctorPrefix: users.prefix,
        fee: users.consultationFee,
        chargeConsultation: appointments.chargeConsultation,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        procedureNames: appointmentProcedureNamesSql(),
        proceduresGross: appointmentProceduresGrossSql(),
        proceduresTotal: appointmentProceduresNetSql(),
        queueNumber: appointments.queueNumber,
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
          and(eq(appointments.id, appointmentId), isNotNull(patients.phone)),
        ),
      )
      .limit(1);

    if (!r || !r.patientPhone) return;

    const doctor =
      r.doctorName || r.doctorUsername
        ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "")
        : null;
    const when = formatWhen(r.scheduledAt);
    // Quote the net total the patient pays: consultation fee + procedures, less
    // any per-appointment discount.
    const { gross, net } = billFromTotals(
      doctor && r.chargeConsultation ? r.fee : 0,
      Number(r.proceduresGross),
      Number(r.proceduresTotal),
      r.discountType === "percent" ? "percent" : "amount",
      effectiveDiscountValue(r.discountStatus, r.discountValue),
    );
    const fee = formatFee(gross > 0 ? net : null);
    // Queue token the patient should quote at the desk (only doctor bookings
    // carry one).
    const token = doctor && r.queueNumber != null ? `#${r.queueNumber}` : null;
    const tokenStr = token ? ` Your token number is ${token}.` : "";
    // What the visit is FOR. A patient booked for a root canal at 6pm should not get
    // a message reading only "Appointment confirmed" — the more so now that a visit can
    // be scheduled outside the doctor's usual hours, where the time by itself is the
    // thing most likely to look like a mistake.
    const procedures = r.procedureNames ?? null;
    const forStr = procedures ? ` for ${procedures}` : "";
    // Only the appointment's own day/date/time — never the doctor's weekly hours.
    const body = doctor
      ? `Appointment confirmed${forStr} with ${doctor} on ${when}. Fee: ${fee}.${tokenStr}\n${r.clinicName}`
      : `Appointment confirmed${forStr} on ${when}.\n${r.clinicName}`;

    await sendWhatsAppToPatient({
      clinicId,
      patientId: r.patientId,
      phone: r.patientPhone,
      campaignName: serverEnv.AISENSY_BOOKING_CAMPAIGN,
      userName: r.patientName,
      templateParams: [
        r.patientName,
        doctor ?? "the clinic",
        when,
        fee,
        r.clinicName,
        token ?? "",
        // APPENDED, never inserted: the provider maps params by POSITION, so adding
        // one in the middle silently shifts every later placeholder.
        procedures ?? "",
      ],
      body,
    });
  } catch (e) {
    // Best-effort: never let a notification error affect the booking. The patient
    // simply never received their confirmation, which they will ask about.
    report(e, { op: "notifications.appointmentBooked", clinicId, ids: { appointmentId } });
  }
}

/**
 * Day-before reminder engine — CORE, platform-wide (runs from the daily cron).
 * Finds every active (scheduled/confirmed) appointment happening TOMORROW that
 * hasn't been reminded yet and whose patient has a phone, and sends a WhatsApp
 * reminder with the doctor and time. On success the appointment is stamped
 * `reminderSentAt` so it's never reminded twice; a failed send is left for the
 * next run. Returns counts for the cron response.
 */
export async function sendDueAppointmentReminders(
  now: Date = new Date(),
): Promise<{ processed: number; sent: number; skipped: number }> {
  // Local "tomorrow" window: [tomorrow 00:00, day-after 00:00).
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const rows = await db
    .select({
      apptId: appointments.id,
      clinicId: appointments.clinicId,
      scheduledAt: appointments.scheduledAt,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      procedureNames: appointmentProcedureNamesSql(),
      clinicName: clinics.name,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(clinics, eq(appointments.clinicId, clinics.id))
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(
      and(
        notDeleted(appointments.deletedAt),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        gte(appointments.scheduledAt, start),
        lt(appointments.scheduledAt, end),
        isNull(appointments.reminderSentAt),
        isNotNull(patients.phone),
      ),
    );

  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.patientPhone) {
      skipped++;
      continue;
    }
    const doctor = displayStaffName(
      r.doctorPrefix,
      r.doctorName,
      r.doctorUsername ?? "your doctor",
    );
    const when = formatWhen(r.scheduledAt);
    // Same reasoning as the confirmation: name the procedure. The day-out reminder
    // is also the last chance to catch a patient who misremembered what they booked.
    const procedures = r.procedureNames ?? null;
    const forStr = procedures ? ` for ${procedures}` : "";
    const result = await sendWhatsAppToPatient({
      clinicId: r.clinicId,
      patientId: r.patientId,
      phone: r.patientPhone,
      campaignName: serverEnv.AISENSY_REMINDER_CAMPAIGN,
      userName: r.patientName,
      // Appended, not inserted — provider templates map params by POSITION.
      templateParams: [r.patientName, doctor, when, r.clinicName, procedures ?? ""],
      body: `Reminder: your appointment${forStr} with ${doctor} is on ${when}.\n${r.clinicName}`,
    });

    if (result.ok) {
      await db
        .update(appointments)
        .set({ reminderSentAt: new Date(), updatedAt: new Date() })
        .where(eq(appointments.id, r.apptId));
      sent++;
    } else {
      // Leave reminderSentAt null so the next run retries.
      skipped++;
    }
  }

  return { processed: rows.length, sent, skipped };
}
