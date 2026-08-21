import { and, eq } from "drizzle-orm";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { readFileByKey } from "@/core/integrations/storage";
import { report } from "@/core/observability";

/**
 * GET /api/admin/clinics/[id]/logo — serves a clinic's logo for the ADMIN preview, so
 * the large image isn't inlined as a data-URI prop into the (server-action-using) logo
 * form (which would trip Next's 1 MB Server-Action body limit). Gated to an admin who
 * can view the clinic (full admin OR the assigned account manager). Print documents
 * still inline the logo (reliability); this route is only for the on-screen preview.
 */
const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminCapability("clinics:view");
  const [c] = await db
    .select({ logoKey: clinics.logoKey, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, id), notDeleted(clinics.deletedAt)))
    .limit(1);
  if (!c || !c.logoKey) return new Response("Not found", { status: 404 });
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const data = await readFileByKey(c.logoKey);
    const ext = c.logoKey.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // The row says this file exists but the bytes could not be read, so the DB and
    // the file store disagree. Returning 404 is right for the caller, but it makes a
    // MISSING FILE look identical to a missing record — the exact shape data loss on
    // an ephemeral filesystem would take. Warn: the request is handled, the estate
    // is not.
    report(e, { op: "storage.serveClinicLogo", severity: "warn", ids: { clinicId: id } });
    return new Response("Not found", { status: 404 });
  }
}
