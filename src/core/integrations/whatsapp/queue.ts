import "server-only";

import { count, desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { patients, whatsappMessages } from "@/core/db/schema";
import { byClinic } from "@/core/db/tenant";

/**
 * The clinic's WhatsApp message queue — CORE per ADR-014.
 *
 * No `notDeleted`, deliberately: `whatsapp_messages` is a LOG, not a soft-deletable
 * record. Every send is written before the provider is called so nothing is lost when
 * it is unconfigured, and a message that was sent cannot be un-sent by deleting a row.
 *
 * The patient join is LEFT: an inbound message from an unknown number has no patient
 * yet, and dropping those would hide exactly the ones a receptionist needs to see.
 *
 * `phone` narrows to ONE conversation — what a "new WhatsApp message" notification
 * links to, so the click lands on that exchange instead of the top of a clinic-wide
 * log. It matches on the NUMBER rather than the patient id for the same reason the
 * join is left: an unknown sender has no patient to key on, and those are precisely
 * the messages someone needs to open.
 */
export async function listWhatsappQueue(
  clinicId: string,
  paging: { offset: number; limit: number },
  opts: { phone?: string } = {},
) {
  const where = byClinic(
    whatsappMessages.clinicId,
    clinicId,
    opts.phone ? eq(whatsappMessages.phone, opts.phone) : undefined,
  );
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: whatsappMessages.id,
        direction: whatsappMessages.direction,
        phone: whatsappMessages.phone,
        status: whatsappMessages.status,
        body: whatsappMessages.body,
        createdAt: whatsappMessages.createdAt,
        patientName: patients.fullName,
      })
      .from(whatsappMessages)
      .leftJoin(patients, eq(whatsappMessages.patientId, patients.id))
      .where(where)
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(whatsappMessages).where(where),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}
