import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { clinicalAttachments, patients, type ClinicalAttachment } from "@/core/db/schema";
import { saveClinicFile } from "@/core/integrations/storage";

/**
 * Clinical attachments — CORE data layer (server-only). Metadata rows point at
 * clinic-scoped storage bytes. Photo attachments (`is_photo`) are gated by the
 * patient's `photo_consent` on BOTH upload and serve (CLAUDE.md §10). Clinic-scoped.
 */

/** X-ray/photo/document/consent kinds. `photo` is the only consent-gated one. */
export type AttachmentKind = "xray" | "photo" | "document" | "consent";
const KINDS: AttachmentKind[] = ["xray", "photo", "document", "consent"];

/** A patient's live attachments, newest first (optionally one visit's). */
export async function listAttachments(
  clinicId: string,
  patientId: string,
  opts?: { visitId?: string },
): Promise<ClinicalAttachment[]> {
  return db
    .select()
    .from(clinicalAttachments)
    .where(
      byClinic(
        clinicalAttachments.clinicId,
        clinicId,
        notDeleted(clinicalAttachments.deletedAt),
        eq(clinicalAttachments.patientId, patientId),
        opts?.visitId ? eq(clinicalAttachments.visitId, opts.visitId) : undefined,
      ),
    )
    .orderBy(desc(clinicalAttachments.createdAt));
}

/** The row + the patient's photo-consent, for the authorized serve route. */
export async function getAttachmentForServe(
  clinicId: string,
  id: string,
): Promise<{ storageKey: string; mime: string | null; isPhoto: boolean; photoConsent: boolean } | null> {
  const [row] = await db
    .select({
      storageKey: clinicalAttachments.storageKey,
      mime: clinicalAttachments.mime,
      isPhoto: clinicalAttachments.isPhoto,
      photoConsent: patients.photoConsent,
    })
    .from(clinicalAttachments)
    .innerJoin(patients, eq(patients.id, clinicalAttachments.patientId))
    .where(
      byClinic(
        clinicalAttachments.clinicId,
        clinicId,
        notDeleted(clinicalAttachments.deletedAt),
        eq(clinicalAttachments.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getPhotoConsent(clinicId: string, patientId: string): Promise<boolean> {
  const [row] = await db
    .select({ photoConsent: patients.photoConsent })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, eq(patients.id, patientId)))
    .limit(1);
  return row?.photoConsent ?? false;
}

export async function setPhotoConsent(clinicId: string, patientId: string, value: boolean): Promise<void> {
  await db
    .update(patients)
    .set({ photoConsent: value, updatedAt: new Date() })
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)));
}

/**
 * Store an attachment's bytes + metadata. Photo kinds require the patient's
 * photo_consent (enforced here, not just the UI). Returns the new id or an error.
 */
export async function createAttachment(
  clinicId: string,
  input: {
    patientId: string;
    visitId?: string | null;
    kind: AttachmentKind;
    caption?: string | null;
    data: Buffer;
    ext: string;
    mime: string;
  },
  actor: { id: string; name: string },
): Promise<{ id: string } | { error: string }> {
  const kind = KINDS.includes(input.kind) ? input.kind : "document";
  const isPhoto = kind === "photo";

  if (isPhoto && !(await getPhotoConsent(clinicId, input.patientId))) {
    return { error: "Photo consent is required before uploading a patient photo." };
  }

  const key = await saveClinicFile(clinicId, "clinical", input.data, input.ext);
  const [row] = await db
    .insert(clinicalAttachments)
    .values({
      clinicId,
      patientId: input.patientId,
      visitId: input.visitId ?? null,
      kind,
      storageKey: key,
      mime: input.mime.slice(0, 100),
      caption: input.caption?.slice(0, 200) || null,
      takenAt: new Date(),
      isPhoto,
      uploadedBy: actor.id,
      uploadedByName: actor.name,
    })
    .returning({ id: clinicalAttachments.id });
  return { id: row.id };
}

/** Soft-delete an attachment (bytes remain, recoverable). */
export async function softDeleteAttachment(
  clinicId: string,
  id: string,
  actorId: string,
): Promise<boolean> {
  const res = await db
    .update(clinicalAttachments)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(
      byClinic(
        clinicalAttachments.clinicId,
        clinicId,
        notDeleted(clinicalAttachments.deletedAt),
        eq(clinicalAttachments.id, id),
      ),
    )
    .returning({ id: clinicalAttachments.id });
  return res.length > 0;
}
