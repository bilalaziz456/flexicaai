import { apiRequireWorkspace } from "@/core/auth/user";
import { buildLetterheadEstimatePdf } from "@/core/clinics/letterhead";
import { contentDisposition } from "@/core/lib/file-name";

/**
 * GET /api/estimate/[id] — a treatment plan's estimate as a PDF on the clinic's
 * letterhead, like a typed prescription (/api/rx). `?pad=1` prints only the writing,
 * for the clinic's own pre-printed paper. `?download=1` saves it instead of opening it.
 * Clinic-scoped, `plans:view`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequireWorkspace("plans", "view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const url = new URL(req.url);
  const out = await buildLetterheadEstimatePdf(auth.clinicId, id, { pad: url.searchParams.get("pad") === "1" });
  if (!out) return new Response("Not found", { status: 404 });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(Buffer.from(out.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(disposition, out.filename),
      "Cache-Control": "private, no-store",
    },
  });
}
