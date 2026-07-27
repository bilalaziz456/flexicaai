import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, patients } from "@/core/db/schema";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { formatMrn, mrnDigits } from "@/core/patients/mrn";
import { ageFromDob } from "@/core/lib/age";

/**
 * GET /api/patients/export?q=… — the clinic's patient list as a CSV. Auth +
 * clinic-scoped + `patients:view`; the optional `q` mirrors the list search (name /
 * phone / MRN) so the download matches what's on screen. UTF-8 BOM so Excel opens
 * Urdu/Arabic names; brand credit appended.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user?.clinicId || !can(user, "patients", "view")) {
    return new Response("Forbidden", { status: 403 });
  }
  const clinicId = user.clinicId;
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";

  let search;
  if (query) {
    const conds = [ilike(patients.fullName, `%${query}%`), ilike(patients.phone, `%${query}%`)];
    const digits = mrnDigits(query);
    if (digits)
      conds.push(
        sql`(to_char(${patients.createdAt}, 'YYYYMMDD') || lpad(${patients.mrn}::text, 7, '0')) ilike ${`%${digits}%`}`,
      );
    search = or(...conds);
  }
  const where = byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), search);

  const [clinicRow] = await db
    .select({ mrnPrefix: clinics.mrnPrefix })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const mrnPrefix = clinicRow?.mrnPrefix ?? "";

  const rows = await db
    .select({
      mrn: patients.mrn,
      createdAt: patients.createdAt,
      fullName: patients.fullName,
      phone: patients.phone,
      email: patients.email,
      gender: patients.gender,
      dateOfBirth: patients.dateOfBirth,
      reference: patients.reference,
    })
    .from(patients)
    .where(where)
    .orderBy(desc(patients.createdAt));

  const csv = toCsv(
    ["MRN", "Name", "Phone", "Email", "Gender", "Age", "Reference", "Registered"],
    rows.map((p) => [
      formatMrn(mrnPrefix, p.mrn, p.createdAt) ?? "",
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
