import "server-only";

import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients, recalls } from "@/core/db/schema";
import { clinicUsableSql } from "@/core/clinics/usable-sql";
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
    // Only clinics that can be used: a clinic whose trial ended, or that is paused,
    // sends its patients nothing (owner, 2026-11-17). Its recalls wait, and are
    // dropped — not sent late — when it comes back (`cancelRecallsMissedWhileLocked`).
    .innerJoin(clinics, eq(clinics.id, recalls.clinicId))
    .where(
      and(
        notDeleted(recalls.deletedAt),
        inArray(recalls.status, ["pending"]),
        lte(recalls.dueAt, now),
        clinicUsableSql(now),
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

/**
 * A clinic that comes back — trial extended, activated, resumed — STARTS FROM SCRATCH
 * (owner, 2026-11-17): the recalls that fell due while it was locked are cancelled
 * rather than sent weeks late, all at once. `lockedSince` is when it lost access
 * (`clinicLockedSince`); null when unknown, which drops every recall already due.
 * Returns how many were cancelled.
 */
export async function cancelRecallsMissedWhileLocked(
  clinicId: string,
  lockedSince: Date | null,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(recalls)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      byClinic(
        recalls.clinicId,
        clinicId,
        and(
          notDeleted(recalls.deletedAt),
          inArray(recalls.status, ["pending"]),
          lte(recalls.dueAt, now),
          lockedSince ? gte(recalls.dueAt, lockedSince) : undefined,
        ),
      ),
    )
    .returning({ id: recalls.id });
  return rows.length;
}
