import { NextResponse } from "next/server";
import { apiRequireAdminCapability } from "@/core/auth/user";
import { exportClinicData } from "@/core/admin/export";

/**
 * GET /api/admin/clinics/[id]/export — downloads a clinic's data as JSON (Feature
 * 10). super-admin + `clinics:manage`. Route handler, so we return 403 rather than
 * redirect. Auth secrets are excluded in `exportClinicData`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiRequireAdminCapability("clinics:view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const data = await exportClinicData(id);
  if (!data) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  const filename = `clinic-${id}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
