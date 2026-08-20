import { desc, eq } from "drizzle-orm";
import { apiRequireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, procedures } from "@/core/db/schema";
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

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await db
    .select({
      name: procedures.name,
      price: procedures.price,
      isActive: procedures.isActive,
    })
    .from(procedures)
    .where(byClinic(procedures.clinicId, clinicId, notDeleted(procedures.deletedAt)))
    .orderBy(desc(procedures.createdAt));

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
