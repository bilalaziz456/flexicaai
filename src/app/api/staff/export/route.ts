import { and, desc, ilike, inArray, or } from "drizzle-orm";
import { apiRequireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { CLINIC_STAFF_ROLES, displayStaffName } from "@/core/types/auth";
import { describeAvailability } from "@/core/lib/availability";

/**
 * GET /api/staff/export?q=… — the clinic's staff list as a CSV. Auth + clinic-scoped
 * + `staff:view` (same gate as the list page); the optional `q` mirrors the list
 * search (name / username). UTF-8 BOM for Excel; brand credit appended.
 */
export async function GET(req: Request) {
  const auth = await apiRequireWorkspace("staff", "view");
  if (!auth.ok) return auth.response;
  const { clinicId } = auth;
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";

  const roleFilter = inArray(users.role, [...CLINIC_STAFF_ROLES]);
  const search = query
    ? or(ilike(users.fullName, `%${query}%`), ilike(users.username, `%${query}%`))
    : undefined;
  const where = byClinic(
    users.clinicId,
    clinicId,
    notDeleted(users.deletedAt),
    search ? and(roleFilter, search) : roleFilter,
  );

  const rows = await db
    .select({
      username: users.username,
      prefix: users.prefix,
      fullName: users.fullName,
      role: users.role,
      email: users.email,
      isActive: users.isActive,
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt));

  const csv = toCsv(
    ["Name", "Username", "Role", "Email", "Status", "Consultation fee (PKR)", "Daily limit", "Availability"],
    rows.map((u) => [
      displayStaffName(u.prefix, u.fullName, u.username),
      u.username,
      u.role,
      u.email ?? "",
      u.isActive ? "Active" : "Suspended",
      u.role === "doctor" ? u.fee : "",
      u.role === "doctor" ? (u.dailyLimit > 0 ? u.dailyLimit : "unlimited") : "",
      u.role === "doctor" ? describeAvailability(u.availability) : "",
    ]),
  );

  const body = "﻿" + csv + `\r\n\r\n${BRAND_POWERED_BY}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="staff-${ymd(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
