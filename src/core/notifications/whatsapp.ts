import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { whatsappMessages, type WhatsappNotes } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import {
  isWhatsAppConfigured,
  normalisePhone,
  sendWhatsAppTemplate,
  type SendTemplateArgs,
} from "@/core/integrations/whatsapp";
import { getClinicSender } from "@/core/notifications/clinic-whatsapp";

/**
 * WhatsApp notification channel — CORE. Records the outbound message FIRST
 * (status "queued"), then attempts delivery via the provider and updates the
 * status. Recording first means the receptionist queue and audit trail capture
 * every attempt, even if the provider is unconfigured or the send fails.
 */
export async function sendWhatsAppToPatient(args: {
  clinicId: string;
  patientId?: string | null;
  phone: string;
  campaignName: string;
  userName?: string;
  templateParams?: string[];
  media?: { url: string; filename: string };
  /** Human-readable preview stored on the message row. */
  body?: string;
  /**
   * The event kind — selects the clinic's per-event custom note ({{note}}) on the
   * Cloud API provider. Omit for events without a note slot (cancel / prescription /
   * reschedule / booking-reply); the signature is still applied.
   */
  event?: keyof WhatsappNotes;
}): Promise<{ messageId: string; ok: boolean; error?: string }> {
  const phone = normalisePhone(args.phone);

  const [row] = await db
    .insert(whatsappMessages)
    .values({
      clinicId: args.clinicId,
      patientId: args.patientId ?? null,
      direction: "outbound",
      phone,
      status: "queued",
      templateName: args.campaignName,
      body: args.body ?? null,
      mediaUrl: args.media?.url ?? null,
    })
    .returning({ id: whatsappMessages.id });
  const messageId = row.id;

  if (!isWhatsAppConfigured()) {
    await db
      .update(whatsappMessages)
      .set({
        status: "failed",
        error: "WhatsApp is not configured for this platform.",
        updatedAt: new Date(),
      })
      .where(eq(whatsappMessages.id, messageId));
    return { messageId, ok: false, error: "WhatsApp is not configured." };
  }

  // On the Cloud API, resolve THIS clinic's sender number + personalization so the
  // message is sent FROM the clinic's own number with its signature/note. AiSensy
  // (default) ignores these fields, so we skip the lookup entirely there.
  const cloud =
    serverEnv.WHATSAPP_PROVIDER === "cloud"
      ? await getClinicSender(args.clinicId)
      : null;
  const note =
    args.event && cloud?.notes ? (cloud.notes[args.event] ?? null) : null;

  const send: SendTemplateArgs = {
    to: phone,
    campaignName: args.campaignName,
    userName: args.userName,
    templateParams: args.templateParams,
    media: args.media,
    phoneNumberId: cloud?.phoneNumberId ?? null,
    note,
    signature: cloud?.signature ?? null,
  };
  const result = await sendWhatsAppTemplate(send);

  await db
    .update(whatsappMessages)
    .set(
      result.ok
        ? { status: "sent", externalId: result.externalId ?? null, updatedAt: new Date() }
        : { status: "failed", error: result.error, updatedAt: new Date() },
    )
    .where(eq(whatsappMessages.id, messageId));

  return result.ok
    ? { messageId, ok: true }
    : { messageId, ok: false, error: result.error };
}
