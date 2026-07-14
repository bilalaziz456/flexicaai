import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, type WhatsappNotes } from "@/core/db/schema";

/**
 * A clinic's WhatsApp sender config (Meta Cloud API). `phoneNumberId` selects the
 * number a message is sent FROM; `signature` / `notes` are the clinic-customisable
 * text fed into the templates' {{signature}} / {{note}} vars. NULL phoneNumberId =
 * the clinic hasn't been provisioned → the send fails gracefully (logged, not sent).
 * See docs/whatsapp-cloud-plan.md.
 */
export type ClinicWhatsappSender = {
  phoneNumberId: string | null;
  displayNumber: string | null;
  senderName: string | null;
  signature: string | null;
  notes: WhatsappNotes | null;
};

/** Resolve a clinic's WhatsApp sender config by clinic id. */
export async function getClinicSender(
  clinicId: string,
): Promise<ClinicWhatsappSender | null> {
  const [row] = await db
    .select({
      phoneNumberId: clinics.whatsappPhoneNumberId,
      displayNumber: clinics.whatsappDisplayNumber,
      senderName: clinics.whatsappSenderName,
      signature: clinics.whatsappSignature,
      notes: clinics.whatsappNotes,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return row ?? null;
}

/**
 * Inbound routing: which clinic OWNS a WABA number. The Cloud API webhook maps the
 * receiving `phone_number_id` to a clinic, then matches the patient WITHIN it.
 * `whatsapp_phone_number_id` is unique when set, so this yields at most one clinic
 * (NULL/empty → no clinic).
 */
export async function getClinicIdByPhoneNumberId(
  phoneNumberId: string,
): Promise<string | null> {
  if (!phoneNumberId) return null;
  const [row] = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.whatsappPhoneNumberId, phoneNumberId))
    .limit(1);
  return row?.id ?? null;
}
