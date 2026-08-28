"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { displayStaffName } from "@/core/types/auth";
import {
  createAttachment,
  setPhotoConsent,
  softDeleteAttachment,
  type AttachmentKind,
} from "@/core/patients/attachments";
import { logActivity } from "@/core/audit/log";

type State = { ok?: true; error?: string };

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
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
  const caption = (formData.get("caption") as string) || null;
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_BYTES) return { error: "File is too large (max 15 MB)." };

  const ext = EXT_BY_MIME[file.type] ?? (file.name.split(".").pop() ?? "bin");
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
    { patientId, kind, caption, data, ext, mime: file.type || "application/octet-stream", thumb },
    { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) },
  );
  if ("error" in res) return { error: res.error };

  await logActivity({ action: "create", entity: "patient", entityId: patientId, summary: `Uploaded a clinical ${kind}` });
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
