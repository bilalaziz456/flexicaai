import { apiRequireWorkspace } from "@/core/auth/user";
import { getAttachmentForServe } from "@/core/patients/attachments";
import { readFileByKey } from "@/core/integrations/storage";
import { report } from "@/core/observability";

/**
 * GET /api/clinical/attachment/[id] — serves a clinical attachment's bytes. Auth +
 * clinic-scoped + `attachments:view`; a PHOTO is withheld unless the patient's
 * photo_consent is set (§10). `no-store` — clinical bytes are never cached.
 *
 * `?thumb=1` serves the small gallery copy instead, when one exists. It falls back to
 * the original rather than 404ing, so rows uploaded before thumbnails existed — and
 * any where the browser could not make one — still render. **The consent and
 * permission checks above run first either way**: a thumbnail of a patient photo is
 * still a patient photo.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequireWorkspace("attachments", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const row = await getAttachmentForServe(auth.clinicId, id);
  if (!row) return new Response("Not found", { status: 404 });
  if (row.isPhoto && !row.photoConsent) {
    return new Response("Photo consent not granted", { status: 403 });
  }

  const wantsThumb = new URL(req.url).searchParams.get("thumb") === "1";
  const useThumb = wantsThumb && Boolean(row.thumbKey);
  const key = useThumb ? row.thumbKey! : row.storageKey;

  try {
    const data = await readFileByKey(key);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        // The thumbnail is always a JPEG, whatever the original was.
        "Content-Type": useThumb ? "image/jpeg" : (row.mime ?? "application/octet-stream"),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // The row says this file exists but the bytes could not be read, so the DB and
    // the file store disagree. Returning 404 is right for the caller, but it makes a
    // MISSING FILE look identical to a missing record — the exact shape data loss on
    // an ephemeral filesystem would take. Warn: the request is handled, the estate
    // is not.
    report(e, { op: "storage.serveClinicalAttachment", severity: "warn", clinicId: auth.clinicId, ids: { attachmentId: id } });
    return new Response("Not found", { status: 404 });
  }
}
