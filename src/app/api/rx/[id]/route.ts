import { apiRequireWorkspace } from "@/core/auth/user";
import { buildLetterheadPrescriptionPdf } from "@/core/clinics/letterhead";

/**
 * GET /api/rx/[id] — a typed prescription as a PDF on the clinic's letterhead.
 * `?pad=1` prints only the writing, for the clinic's own pre-printed pad.
 * `?download=1` saves it instead of opening it. Clinic-scoped, `prescriptions:view`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequireWorkspace("prescriptions", "view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const url = new URL(req.url);
  const out = await buildLetterheadPrescriptionPdf(auth.clinicId, id, { pad: url.searchParams.get("pad") === "1" });
  if (!out) return new Response("Not found", { status: 404 });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(Buffer.from(out.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${out.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
