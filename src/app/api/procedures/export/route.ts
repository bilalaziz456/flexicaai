import { apiRequireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { clinicHasFeature } from "@/core/lib/features";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";

/**
 * GET /api/procedures/export — the clinic's procedure catalog as a CSV. Auth +
 * clinic-scoped + `procedures:view`, gated by the `sales` feature (the catalog only
 * exists when billing is on). UTF-8 BOM for Excel; brand credit appended.
 */
export async function GET() {
  const auth = await apiRequireWorkspace("procedures", "view");
  if (!auth.ok) return auth.response;
  const { clinicId } = auth;

  // `getClinic` is request-cached, so repeated reads in one render collapse to one
  // query — an inline `select … from clinics` is both a lint violation and a
  // duplicate round trip (conventions.md §6).
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await listProcedureCatalog(clinicId);

  const csv = toCsv(
    ["Procedure", "Price (PKR)", "Status"],
    rows.map((p) => [p.name, p.price, p.isActive ? "Active" : "Inactive"]),
  );

  const body = "﻿" + csv + `\r\n\r\n${BRAND_POWERED_BY}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="procedures-${ymd(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
