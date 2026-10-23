import { NextResponse } from "next/server";
import { apiRequireWorkspace } from "@/core/auth/user";
import { buildVisitPrescriptionPdf } from "@/core/patients/prescription-build";
import { contentDisposition } from "@/core/lib/file-name";

/**
 * GET /api/prescriptions/[visitId] — serves the visit's prescription PDF to
 * signed-in clinic staff. Clinic-scoped: only staff of the visit's own clinic.
 * (Patients receive it via a signed public link over WhatsApp — see /p/rx.)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const { visitId } = await params;

  // Permission-driven: any clinic staff granted prescription view access.
  const auth = await apiRequireWorkspace("prescriptions", "view");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // The same two options as /api/rx/[id]: `?pad=1` prints without the letterhead,
  // `?download=1` saves it instead of opening it (owner's call, 2026-10-24).
  const url = new URL(request.url);
  const result = await buildVisitPrescriptionPdf(visitId, { pad: url.searchParams.get("pad") === "1" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Tenant isolation: only staff of the visit's own clinic.
  if (result.clinicId !== user.clinicId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new Response(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(url.searchParams.get("download") === "1" ? "attachment" : "inline", result.filename),
      "Cache-Control": "private, no-store",
    },
  });
}
