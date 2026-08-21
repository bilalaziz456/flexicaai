import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patients } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { computeAppointmentTotal, effectiveDiscountValue } from "@/core/appointments/fee";
import {
  appointmentHasProceduresSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import { checkDoctorSlot } from "@/core/appointments/availability";
import { queueSessionKey, withQueueNumber } from "@/core/appointments/queue";
import { parseWhen } from "@/core/appointments/parse-when";
import type { DayAvailability } from "@/core/lib/availability";
import { report } from "@/core/observability";

/** "Mon 13 Jul, 15:00" for the reschedule confirmation. */
function fmtWhen(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  /** The moved appointment's id (set when rescheduled) — for a deep-linked notification. */
  appointmentId?: string | null;
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
        queueSession: appointments.queueSession,
        queueNumber: appointments.queueNumber,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        chargeConsultation: appointments.chargeConsultation,
        proceduresTotal: appointmentProceduresNetSql(),
      })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
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
        "To reschedule, reply with the new date & time, e.g. \"reschedule next Monday 3pm\" or \"reschedule 12 Jul 3:00pm\".",
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
    let doctorName = "your doctor";
    let fee = 0;
    let availability: DayAvailability[] = [];
    let flexible = false;
    if (appt.doctorId) {
      // Moving a visit keeps its procedures, so it keeps access to the doctor's
      // procedure windows — otherwise a procedure booked at 2pm couldn't be
      // moved to 3pm by the patient without the clinic doing it for them.
      const [{ hasProcedures }] = await db
        .select({ hasProcedures: appointmentHasProceduresSql() })
        .from(appointments)
        // Scoped even though `appt` was already resolved within this clinic: the
        // rule is every query filters by clinic_id, and an id-only lookup here is
        // what the tenant guard is built to flag. (It flagged exactly this.)
        .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appt.id)))
        .limit(1);
      const check = await checkDoctorSlot(clinicId, appt.doctorId, when, {
        excludeAppointmentId: appt.id,
        hasProcedures: Boolean(hasProcedures),
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
      doctorName = check.doctorName;
      fee = check.fee;
      availability = check.availability;
      flexible = check.flexible;
    }

    // Move it. Reset the reminder so the day-before reminder re-sends for the new
    // day. We do NOT touch the status — a reschedule to an already-valid slot
    // stays as it was (a confirmed appointment stays confirmed; it isn't a new
    // request needing re-approval). The queue token moves with it: if the new
    // slot is a DIFFERENT window/day, issue a fresh token there; if it's the same
    // session, keep the existing number.
    const where = byClinic(appointments.clinicId, clinicId, eq(appointments.id, appt.id));
    const baseSet = { scheduledAt: when, reminderSentAt: null, updatedAt: new Date() };
    let tokenNumber: number | null = appt.queueNumber;

    if (appt.doctorId) {
      const newSession = queueSessionKey(appt.doctorId, when, availability, flexible);
      if (newSession === appt.queueSession) {
        await db.update(appointments).set(baseSet).where(where);
      } else {
        await withQueueNumber(
          { clinicId, doctorId: appt.doctorId, when, availability, flexible },
          (q) => {
            tokenNumber = q.queueNumber;
            return db
              .update(appointments)
              .set({ ...baseSet, queueSession: q.queueSession, queueNumber: q.queueNumber })
              .where(where);
          },
        );
      }
    } else {
      await db.update(appointments).set(baseSet).where(where);
    }

    // Tell the patient it's rescheduled (accurate wording — not "confirmed").
    // Quote the full net total the patient pays: consultation fee + procedures −
    // discount (the procedures don't change on a move).
    const { gross, net } = computeAppointmentTotal(
      appt.chargeConsultation ? fee : 0,
      Number(appt.proceduresTotal),
      appt.discountType === "percent" ? "percent" : "amount",
      effectiveDiscountValue(appt.discountStatus, appt.discountValue),
    );
    const feeStr =
      gross > 0 ? ` Total: Rs ${new Intl.NumberFormat("en-PK").format(net)}.` : "";
    const tokenStr = tokenNumber != null ? ` Your token number is #${tokenNumber}.` : "";
    await reply(
      clinicId,
      patientId,
      phone,
      `Your appointment has been rescheduled to ${fmtWhen(when)} with ${doctorName}.${feeStr}${tokenStr}`,
    );
    return { handled: true, rescheduled: true, appointmentId: appt.id };
  } catch (e) {
    // Best-effort: an inbound webhook must never fail on a reschedule attempt.
    // Same reasoning as booking — the patient is left with silence.
    report(e, { op: "appointments.handleRescheduleReply", clinicId, ids: { patientId } });
    return { handled: true, rescheduled: false };
  }
}
