import { apiRequireWorkspace } from "@/core/auth/user";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { listPatientsForExport } from "@/core/patients/list";
import { ageFromDob } from "@/core/lib/age";

/**
 * GET /api/patients/export?q=… — the clinic's patient list as a CSV. Auth +
 * clinic-scoped + `patients:view`; the optional `q` mirrors the list search (name /
 * phone / MRN) so the download matches what's on screen. UTF-8 BOM so Excel opens
 * Urdu/Arabic names; brand credit appended.
 */
export async function GET(req: Request) {
  const auth = await apiRequireWorkspace("patients", "view");
  if (!auth.ok) return auth.response;
  const { clinicId } = auth;
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";

  const rows = await listPatientsForExport(clinicId, query);


  const csv = toCsv(
    ["MRN", "Name", "Phone", "Email", "Gender", "Age", "Reference", "Registered"],
    rows.map((p) => [
      p.mrnLabel ?? "",
      p.fullName,
      p.phone ?? "",
      p.email ?? "",
      p.gender ?? "",
      ageFromDob(p.dateOfBirth) ?? "",
      p.reference ?? "",
      ymd(p.createdAt),
    ]),
  );

  const body = "﻿" + csv + `\r\n\r\n${BRAND_POWERED_BY}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patients-${ymd(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
