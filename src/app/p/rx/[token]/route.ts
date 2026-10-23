import { NextResponse } from "next/server";
import { verifyToken } from "@/core/lib/signed-link";
import { buildVisitPrescriptionPdf } from "@/core/patients/prescription-build";
import { contentDisposition } from "@/core/lib/file-name";

/**
 * GET /p/rx/[token] — public, no-session prescription PDF. The signed token IS
 * the authorization: it carries the visit id + an expiry and is HMAC-verified,
 * so only someone holding a link we handed out (over WhatsApp) can open it, and
 * only until it expires. Used to deliver prescriptions to patients.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const visitId = verifyToken(token);
  if (!visitId) {
    return NextResponse.json(
      { error: "This link is invalid or has expired." },
      { status: 404 },
    );
  }

  const result = await buildVisitPrescriptionPdf(visitId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new Response(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("inline", result.filename),
      "Cache-Control": "private, no-store",
    },
  });
}
