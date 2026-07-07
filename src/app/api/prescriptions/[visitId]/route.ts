import { NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/user";
import { buildPrescriptionPdf } from "../build";

/**
 * GET /api/prescriptions/[visitId] — serves the visit's prescription PDF to
 * signed-in clinic staff. Clinic-scoped: only staff of the visit's own clinic.
 * (Patients receive it via a signed public link over WhatsApp — see /p/rx.)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const { visitId } = await params;

  const user = await getCurrentUser();
  const allowed = ["doctor", "clinic_admin", "receptionist"];
  if (!user || !user.clinicId || !allowed.includes(user.role ?? "")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const result = await buildPrescriptionPdf(visitId);
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
      "Content-Disposition": `inline; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
