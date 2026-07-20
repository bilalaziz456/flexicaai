import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getAttachmentForServe } from "@/core/patients/attachments";
import { readFileByKey } from "@/core/integrations/storage";

/**
 * GET /api/clinical/attachment/[id] — serves a clinical attachment's bytes. Auth +
 * clinic-scoped + `attachments:view`; a PHOTO is withheld unless the patient's
 * photo_consent is set (§10). `no-store` — clinical bytes are never cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.clinicId) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "attachments", "view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const row = await getAttachmentForServe(user.clinicId, id);
  if (!row) return new Response("Not found", { status: 404 });
  if (row.isPhoto && !row.photoConsent) {
    return new Response("Photo consent not granted", { status: 403 });
  }

  try {
    const data = await readFileByKey(row.storageKey);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": row.mime ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
