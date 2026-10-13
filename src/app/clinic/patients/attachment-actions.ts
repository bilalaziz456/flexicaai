"use server";

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL, fileSizeLabel } from "@/core/patients/attachment-limits";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import {
  ATTACHMENT_MIME_EXT,
  createAttachment,
  setPhotoConsent,
  softDeleteAttachment,
  type AttachmentKind,
} from "@/core/patients/attachments";
import { logActivity } from "@/core/audit/log";

type State = { ok?: true; error?: string };

/** A 640px JPEG lands well under this; anything larger is not a thumbnail. */
const MAX_THUMB_BYTES = 400 * 1024;

function revalidate(patientId: string) {
  revalidatePath(`/clinic/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
}

/** Upload a clinical attachment (x-ray/photo/document/consent). Gated `attachments:create`. */
export async function uploadAttachmentAction(
  patientId: string,
  formData: FormData,
): Promise<State> {
  const user = await requireRole(["clinic_admin", "doctor", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "attachments", "create")) return { error: "You don't have permission to upload." };

  const file = formData.get("file");
  const kind = (formData.get("kind") as AttachmentKind) || "document";
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: `${file.name} is ${fileSizeLabel(file.size)} — the limit is ${MAX_ATTACHMENT_LABEL}.` };
  }
  // Images and PDF only: the type is served back to the browser, so anything else
  // (an HTML page, say) must not get in at all.
  const ext = ATTACHMENT_MIME_EXT[file.type];
  if (!ext) return { error: "Upload a JPG, PNG, WebP image or a PDF." };
  // No label typed → the file's own name, so no file is ever shown nameless.
  const caption = String(formData.get("caption") ?? "").trim() || file.name.trim() || null;
  const data = Buffer.from(await file.arrayBuffer());

  // Optional gallery thumbnail, generated in the browser beside the original. Treated
  // as untrusted like any other upload: it must be a small JPEG or it is dropped, and
  // dropping it only costs the grid its optimisation.
  const thumbFile = formData.get("thumb");
  const thumb =
    thumbFile instanceof File &&
    thumbFile.size > 0 &&
    thumbFile.size <= MAX_THUMB_BYTES &&
    thumbFile.type === "image/jpeg"
      ? Buffer.from(await thumbFile.arrayBuffer())
      : null;

  const res = await createAttachment(
    user.clinicId,
    { patientId, kind, caption, data, ext, mime: file.type, thumb },
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  );
  if ("error" in res) return { error: res.error };

  await logActivity({
    action: "create",
    entity: "patient",
    entityId: patientId,
    summary: kind === "history" ? "Uploaded a medical history document" : `Uploaded a clinical ${kind}`,
  });
  revalidate(patientId);
  return { ok: true };
}

/** Soft-delete an attachment. Gated `attachments:delete`. */
export async function deleteAttachmentAction(id: string, patientId: string): Promise<State> {
  const user = await requireRole(["clinic_admin", "doctor", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "attachments", "delete")) return { error: "You don't have permission to delete." };
  const ok = await softDeleteAttachment(user.clinicId, id, user.id);
  if (!ok) return { error: "Attachment not found." };
  await logActivity({ action: "delete", entity: "patient", entityId: patientId, summary: "Removed a clinical attachment" });
  revalidate(patientId);
  return { ok: true };
}

/** Record / withdraw the patient's photo consent. Gated `attachments:create`. */
export async function setPhotoConsentAction(patientId: string, value: boolean): Promise<State> {
  const user = await requireRole(["clinic_admin", "doctor", "manager", "receptionist"]);
  if (!user.clinicId) return { error: "No clinic access." };
  if (!can(user, "attachments", "create")) return { error: "You don't have permission for that." };
  await setPhotoConsent(user.clinicId, patientId, value);
  await logActivity({
    action: "update",
    entity: "patient",
    entityId: patientId,
    summary: value ? "Recorded photo consent" : "Withdrew photo consent",
  });
  revalidate(patientId);
  return { ok: true };
}
