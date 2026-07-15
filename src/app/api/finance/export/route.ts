import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { toCsv } from "@/core/lib/csv";
import { resolveSalesRange } from "@/core/sales/report";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import { listExpenses } from "@/core/expenses";
import { getDayBookLines } from "@/core/finance/daybook";

/**
 * GET /api/finance/export?type=daybook|expenses|discounts&… — a CSV download of a
 * finance report. Auth + clinic-scoped + per-report feature/permission gate. The
 * filters mirror each report page (period/from/to, or date for the day book).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user?.clinicId) return new Response("Unauthorized", { status: 401 });
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";

  const [clinic] = await db
    .select({ features: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const hasSales = clinicHasFeature(clinic?.features, "sales");
  const hasFinance = clinicHasFeature(clinic?.features, "finance");

  let name = "report";
  let csv = "";

  if (type === "daybook") {
    if (!hasSales || !can(user, "billing", "view")) return new Response("Forbidden", { status: 403 });
    const date = url.searchParams.get("date") || todayStr();
    const lines = await getDayBookLines(clinicId, date);
    name = `daybook-${date}`;
    csv = toCsv(
      ["Time", "Type", "Method", "Amount", "Note"],
      lines.map((l) => [l.time, l.type, l.method, l.amount, l.note]),
    );
  } else if (type === "expenses") {
    if (!hasFinance || !can(user, "expenses", "view")) return new Response("Forbidden", { status: 403 });
    const range = resolveSalesRange(url.searchParams.get("period") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    const { rows } = await listExpenses(clinicId, {
      from: range.start,
      toExclusive: range.end,
      categoryId: url.searchParams.get("categoryId") || undefined,
      method: url.searchParams.get("method") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: 10000,
    });
    name = `expenses-${range.from}_to_${range.to}`;
    csv = toCsv(
      ["Date", "Category", "Vendor", "Method", "Reference", "Amount", "Note", "Recurring"],
      rows.map((e) => [e.incurredOn, e.categoryName ?? "", e.vendor ?? "", e.method ?? "", e.reference ?? "", e.amount, e.note ?? "", e.recurring ? "yes" : "no"]),
    );
  } else if (type === "discounts") {
    if (!hasSales || !can(user, "discounts", "view")) return new Response("Forbidden", { status: 403 });
    const range = resolveSalesRange(url.searchParams.get("period") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    const report = await getDiscountsReport(clinicId, range, {
      doctorId: url.searchParams.get("doctorId") || undefined,
      borneBy: url.searchParams.get("borneBy") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    name = `discounts-${range.from}_to_${range.to}`;
    csv = toCsv(
      ["Date", "Patient", "Doctor", "Type", "Value", "Amount", "Borne by", "Status"],
      report.rows.map((r) => [ymd(r.scheduledAt), r.patientName ?? "", r.doctorName ?? "", r.type, r.value, r.amount, r.borneBy, r.status]),
    );
  } else {
    return new Response("Unknown report", { status: 400 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
