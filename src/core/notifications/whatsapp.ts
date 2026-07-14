import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { whatsappMessages } from "@/core/db/schema";
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

  // On the Cloud API, resolve THIS clinic's sender number + signature so the message
  // is sent FROM the clinic's own number with its signature. AiSensy (default)
  // ignores these fields, so we skip the lookup entirely there.
  const cloud =
    serverEnv.WHATSAPP_PROVIDER === "cloud"
      ? await getClinicSender(args.clinicId)
      : null;

  const send: SendTemplateArgs = {
    to: phone,
    campaignName: args.campaignName,
    userName: args.userName,
    templateParams: args.templateParams,
    media: args.media,
    phoneNumberId: cloud?.phoneNumberId ?? null,
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
