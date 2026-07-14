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
