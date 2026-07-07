"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics, patients, visits } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { isPublicLinkingEnabled, signToken } from "@/core/lib/signed-link";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";

/**
 * Doctor actions on scribe drafts — CLAUDE.md §8: AI output is a DRAFT until the
 * doctor approves it. All queries are scoped to the doctor's own clinic_id.
 */

/** Approve a draft: save the (edited) note and mark it approved. */
export async function approveVisit(
  visitId: string,
  note: Record<string, unknown>,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };

  const result = await db
    .update(visits)
    .set({
      note,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) return { error: "Draft not found." };
  revalidatePath("/doctor");
  return { ok: true };
}

/** Discard a draft the doctor doesn't want to keep. */
export async function discardDraft(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };

  const result = await db
    .delete(visits)
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) return { error: "Draft not found." };
  revalidatePath("/doctor");
  return { ok: true };
}

/** Search this clinic's patients by name/phone for the scribe picker. */
export async function searchPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return [];
  const q = query.trim();

  const { patients } = await import("@/core/db/schema");
  const { ilike, or, and: and2, desc } = await import("drizzle-orm");

  return db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
    })
    .from(patients)
    .where(
      q
        ? and2(
            eq(patients.clinicId, user.clinicId),
            or(
              ilike(patients.fullName, `%${q}%`),
              ilike(patients.phone, `%${q}%`),
            ),
          )
        : eq(patients.clinicId, user.clinicId),
    )
    .orderBy(desc(patients.createdAt))
    .limit(20);
}

/**
 * Sends an approved visit's prescription to the patient over WhatsApp. Builds a
 * signed, expiring public link to the PDF and delivers it via the module-agnostic
 * WhatsApp channel (AiSensy). Every attempt is logged in whatsapp_messages, so
 * even an unconfigured provider leaves an auditable record.
 */
export async function sendPrescriptionToWhatsApp(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };

  const [row] = await db
    .select({
      clinicId: visits.clinicId,
      status: visits.status,
      patientId: visits.patientId,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      clinicName: clinics.name,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .innerJoin(clinics, eq(visits.clinicId, clinics.id))
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, user.clinicId)))
    .limit(1);

  if (!row) return { error: "Visit not found." };
  if (row.status !== "approved") return { error: "Approve the visit first." };
  if (!row.patientPhone) return { error: "This patient has no phone number." };
  if (!isPublicLinkingEnabled()) {
    return {
      error:
        "Public links are disabled (set LINK_SIGNING_SECRET to send prescriptions).",
    };
  }

  // 30-day signed link the patient can open from WhatsApp without a login.
  const token = signToken(visitId, Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (!token) return { error: "Could not create a secure link." };
  const url = `${serverEnv.APP_URL}/p/rx/${token}`;

  const result = await sendWhatsAppToPatient({
    clinicId: row.clinicId,
    patientId: row.patientId,
    phone: row.patientPhone,
    campaignName: serverEnv.AISENSY_RX_CAMPAIGN,
    userName: row.patientName,
    // Template body params — map these to your approved AiSensy template.
    templateParams: [row.patientName, row.clinicName],
    media: { url, filename: "prescription.pdf" },
    body: `Prescription sent to ${row.patientName}`,
  });

  revalidatePath("/doctor");
  return result.ok ? { ok: true } : { error: result.error ?? "Send failed." };
}
