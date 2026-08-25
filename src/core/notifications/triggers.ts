import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { patients } from "@/core/db/schema";
import { notifyUsersWithPermission } from "@/core/notifications/in-app";

/**
 * In-app notification triggers that are shared across call sites. Per-file triggers
 * (discount approvals, payouts) stay inline where their data lives; this holds the
 * WhatsApp-inbound trigger used by BOTH provider webhooks. All best-effort.
 */

/**
 * An inbound WhatsApp message arrived for a clinic. Routes to the right audience:
 * a self-service **booking** or **reschedule** → the front desk (`appointments:edit`);
 * a plain message → `whatsapp:view`. `patientId` NULL = unattributed number (uses the
 * phone in the text). No-op without a clinic.
 */
export async function notifyInboundWhatsApp(args: {
  clinicId: string | null;
  patientId: string | null;
  phone: string;
  text: string | null;
  outcome: "booked" | "rescheduled" | "message";
  /** The affected appointment's id (booking/reschedule) — deep-links the notification. */
  appointmentId?: string | null;
}): Promise<void> {
  const { clinicId, patientId, phone, text, outcome, appointmentId } = args;
  if (!clinicId) return;
  // Open the exact appointment when we have it; else fall back to the filtered list.
  const apptLink = appointmentId
    ? `/clinic/appointments/${appointmentId}`
    : "/clinic/appointments?status=scheduled";

  let who = phone;
  if (patientId) {
    const [p] = await db
      .select({ name: patients.fullName })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, eq(patients.id, patientId)))
      .limit(1);
    if (p?.name) who = p.name;
  }
  const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : null;

  if (outcome === "booked") {
    await notifyUsersWithPermission(clinicId, "appointments", "edit", {
      type: "appointment.request",
      title: "New booking request",
      body: `${who} booked via WhatsApp. Confirm the slot.`,
      entity: "appointment",
      entityId: appointmentId ?? null,
      link: apptLink,
    });
  } else if (outcome === "rescheduled") {
    await notifyUsersWithPermission(clinicId, "appointments", "edit", {
      type: "appointment.rescheduled",
      title: "Appointment rescheduled",
      body: `${who} rescheduled via WhatsApp.`,
      entity: "appointment",
      entityId: appointmentId ?? null,
      link: apptLink,
    });
  } else {
    await notifyUsersWithPermission(clinicId, "whatsapp", "view", {
      type: "whatsapp.inbound",
      title: "New WhatsApp message",
      body: preview ? `${who}: ${preview}` : `${who} sent a message.`,
      entity: "whatsapp",
      // The queue filtered to THIS conversation. Keyed on the number rather than the
      // patient because an unknown sender has no patient row yet — and those are
      // exactly the messages someone needs to open. Encoded because an E.164 number
      // starts with '+', which is a space once it is in a query string.
      link: `/clinic/whatsapp?phone=${encodeURIComponent(phone)}`,
    });
  }
}
