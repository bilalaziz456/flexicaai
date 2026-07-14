import "server-only";

import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, recalls } from "@/core/db/schema";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { serverEnv } from "@/core/lib/env";

/**
 * Recall engine — CORE, specialty-agnostic (CLAUDE.md §10). It captures a
 * next-visit, schedules it, and — when due — sends a WhatsApp reminder via the
 * core notification channel. `reason` is plain text supplied by the module/note;
 * the engine never knows it's "dental". Booking (status → booked) happens from
 * the reception panel / an inbound WhatsApp reply (Step 11).
 */

/** Create a recall due `afterDays` from now. Returns its id, or null if invalid. */
export async function scheduleRecall(args: {
  clinicId: string;
  patientId: string;
  sourceVisitId?: string | null;
  module?: string | null;
  reason?: string | null;
  afterDays: number;
}): Promise<string | null> {
  if (!Number.isFinite(args.afterDays) || args.afterDays <= 0) return null;
  const dueAt = new Date(Date.now() + args.afterDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(recalls)
    .values({
      clinicId: args.clinicId,
      patientId: args.patientId,
      sourceVisitId: args.sourceVisitId ?? null,
      module: args.module ?? null,
      reason: args.reason ?? null,
      dueAt,
      status: "pending",
    })
    .returning({ id: recalls.id });
  return row.id;
}

export type RecallRunResult = {
  processed: number;
  sent: number;
  skipped: number;
};

/**
 * Finds pending recalls due on/before `now` and sends each a WhatsApp reminder.
 * Success → status "sent" (+ sentAt); a provider failure leaves it "pending" to
 * retry on the next run (the attempt is still logged in whatsapp_messages).
 * Recalls with no patient phone are skipped (stay pending). Run from cron.
 */
export async function processDueRecalls(
  now: Date = new Date(),
): Promise<RecallRunResult> {
  const due = await db
    .select({
      id: recalls.id,
      clinicId: recalls.clinicId,
      patientId: recalls.patientId,
      reason: recalls.reason,
    })
    .from(recalls)
    .where(
      and(
        notDeleted(recalls.deletedAt),
        inArray(recalls.status, ["pending"]),
        lte(recalls.dueAt, now),
      ),
    )
    .limit(200);

  let sent = 0;
  let skipped = 0;

  for (const rc of due) {
    const [patient] = await db
      .select({ phone: patients.phone, name: patients.fullName })
      .from(patients)
      .where(
        and(
          notDeleted(patients.deletedAt),
          eq(patients.id, rc.patientId),
          isNotNull(patients.phone),
        ),
      )
      .limit(1);

    if (!patient?.phone) {
      skipped++;
      continue; // no way to reach them yet; leave pending
    }

    const [clinic] = await db
      .select({ name: clinics.name })
      .from(clinics)
      .where(eq(clinics.id, rc.clinicId))
      .limit(1);

    const reason = rc.reason ?? "a follow-up visit";
    const result = await sendWhatsAppToPatient({
      clinicId: rc.clinicId,
      patientId: rc.patientId,
      phone: patient.phone,
      campaignName: serverEnv.AISENSY_RECALL_CAMPAIGN,
      event: "recall",
      userName: patient.name,
      // Map these to your approved recall template's body params.
      templateParams: [patient.name, reason, clinic?.name ?? ""],
      body: `Recall reminder: ${reason}`,
    });

    if (result.ok) {
      await db
        .update(recalls)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(recalls.id, rc.id));
      sent++;
    } else {
      // Provider failed/unconfigured — leave pending; the message row records why.
      skipped++;
    }
  }

  return { processed: due.length, sent, skipped };
}
