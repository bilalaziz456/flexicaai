import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import { logPatientAction } from "@/core/audit/log";
import { report } from "@/core/observability";

/**
 * Patient self-cancellation over WhatsApp — CORE, feature-gated on `whatsapp_cancel`.
 *
 * DETERMINISTIC, like booking and reschedule: a keyword intent, no model involved. It
 * therefore works with the AI assistant switched off, which is the point — cancelling
 * costs the clinic nothing to run, so it is a policy choice rather than something to
 * charge for (docs/whatsapp-ai-plan.md).
 *
 * It does not implement the transition itself. `applyAppointmentStatus` already owns
 * that and everything hanging off it — the patient notification, the sales ledger, the
 * audit hook — so a second path here would be a second place for those to drift.
 */

/** "Mon 13 Jul, 15:00", matching the reschedule confirmation. */
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
 * True when the message asks to cancel an appointment.
 *
 * Deliberately narrower than the booking and reschedule gates. "Cancel" is the one
 * irreversible intent, so it requires the word itself — no "drop", "skip" or "not
 * coming", which are ambiguous enough that a person should read them. A bare "cancel"
 * counts, because that is what our own canonical reply asks the patient to send.
 */
export function isCancelIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\bcancel(l?ed|ling|lation)?\b/i.test(text);
}

export type CancelOutcome = {
  /** True when this message was a cancellation request, whatever came of it. */
  handled: boolean;
  cancelled: boolean;
  appointmentId?: string | null;
};

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

export async function handleCancelReply(args: {
  clinicId: string;
  patientId: string;
  phone: string;
  text: string;
}): Promise<CancelOutcome> {
  const { clinicId, patientId, phone, text } = args;
  if (!isCancelIntent(text)) return { handled: false, cancelled: false };

  try {
    const clinic = await getClinic(clinicId);
    // Not enabled: this is still a cancellation REQUEST, so it must reach a person
    // rather than be silently dropped — but we neither act nor reply, and returning
    // `handled: false` lets the assistant explain the format if it is switched on.
    if (!clinicHasFeature(clinic?.featuresEnabled, "whatsapp_cancel")) {
      return { handled: false, cancelled: false };
    }

    const now = new Date();
    const [appt] = await db
      .select({ id: appointments.id, scheduledAt: appointments.scheduledAt })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(
            eq(appointments.patientId, patientId),
            gt(appointments.scheduledAt, now),
            // Only a live booking can be cancelled; one already completed,
            // cancelled or marked no-show is not the patient's to change.
            eq(appointments.status, "scheduled"),
          ),
        ),
      )
      .orderBy(asc(appointments.scheduledAt))
      .limit(1);

    if (!appt) {
      await reply(clinicId, patientId, phone, "You don't have an upcoming appointment to cancel.");
      return { handled: true, cancelled: false };
    }

    // THE CUTOFF. Cancelling twenty minutes beforehand is a no-show wearing a polite
    // hat; whether to accept one is a conversation with the desk, not a rule the
    // software should apply. 0 disables it.
    const cutoffHours = clinic?.cancelCutoffHours ?? 0;
    const hoursAway = (appt.scheduledAt.getTime() - now.getTime()) / 3_600_000;
    if (cutoffHours > 0 && hoursAway < cutoffHours) {
      await reply(
        clinicId,
        patientId,
        phone,
        `Your appointment is on ${fmtWhen(appt.scheduledAt)}, which is less than ${cutoffHours} hours away, so we can't cancel it by message. Please call the clinic and we'll sort it out.`,
      );
      return { handled: true, cancelled: false };
    }

    // One path for the transition, shared with the panels (ADR-016 lives in there).
    const changed = await applyAppointmentStatus(clinicId, appt.id, "cancelled");
    if (!changed) return { handled: true, cancelled: false };

    // `applyAppointmentStatus` already messages the patient about the cancellation,
    // so there is deliberately no confirmation reply here — two would be worse than
    // one, and the one it sends is the clinic's own wording.
    await logPatientAction({
      clinicId,
      patientId,
      action: "status",
      entity: "appointment",
      entityId: appt.id,
      summary: `Patient cancelled their appointment on ${fmtWhen(appt.scheduledAt)} over WhatsApp`,
    });
    return { handled: true, cancelled: true, appointmentId: appt.id };
  } catch (e) {
    // An inbound webhook must never fail on a cancellation attempt — but to the
    // patient a silent failure looks like the clinic ignored them, so it is reported.
    report(e, { op: "appointments.handleCancelReply", clinicId, ids: { patientId } });
    return { handled: true, cancelled: false };
  }
}
