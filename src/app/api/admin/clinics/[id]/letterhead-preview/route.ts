import { getClinicLogoAccess } from "@/core/clinics/logo";
import { requireAdminCapability } from "@/core/auth/user";
import { canManageTeam } from "@/core/auth/admin-permissions";
import { buildLetterheadPreviewPdf } from "@/core/clinics/letterhead";
import { clampMargins } from "@/core/lib/letterhead-pdf";

/**
 * GET /api/admin/clinics/[id]/letterhead-preview?top=&bottom=&left=&right= — a sample
 * prescription on the clinic's letterhead with THOSE margins (mm), for the account
 * manager's live preview. Same access as the logo: a full admin or the clinic's
 * assigned account manager.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminCapability("clinics:view");
  const c = await getClinicLogoAccess(id);
  if (!c) return new Response("Not found", { status: 404 });
  if (!canManageTeam(admin) && c.assignedTo !== admin.id) return new Response("Forbidden", { status: 403 });

  const q = new URL(req.url).searchParams;
  const margins = clampMargins({
    topMm: Number(q.get("top")),
    bottomMm: Number(q.get("bottom")),
    leftMm: Number(q.get("left")),
    rightMm: Number(q.get("right")),
  });
  const pdf = await buildLetterheadPreviewPdf(id, margins);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "no-store" },
  });
}
