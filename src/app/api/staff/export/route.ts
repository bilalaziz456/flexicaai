import { apiRequireWorkspace } from "@/core/auth/user";
import { listStaffForExport } from "@/core/users/staff-list";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { displayStaffName } from "@/core/types/auth";
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

  const rows = await listStaffForExport(clinicId, query);

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
