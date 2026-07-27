import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { toCsv } from "@/core/lib/csv";
import { streamCsvResponse } from "@/core/lib/csv-stream";
import { iterateSalesRows, resolveSalesRange } from "@/core/sales/report";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import { getDoctorBalances } from "@/core/sales/payouts";
import { getProfitAndLoss } from "@/core/finance/pl";
import { listExpenses } from "@/core/expenses";
import { getDayBookLines } from "@/core/finance/daybook";
import { getReceivablesReport } from "@/core/finance/receivables";
import { iteratePaymentsLedger, isMoneyOut } from "@/core/finance/payments-ledger";
import { getInvoicesList } from "@/core/billing/invoice";
import { BRAND_POWERED_BY } from "@/core/lib/brand";

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

  // Sales & payments are the two ledgers that grow without bound, so they STREAM:
  // a keyset cursor pages the DB and rows are emitted as they arrive, keeping server
  // memory flat regardless of row count. The remaining (naturally small) reports stay
  // buffered below.
  if (type === "sales") {
    if (!hasSales || !can(user, "sales", "view")) return new Response("Forbidden", { status: 403 });
    const range = resolveSalesRange(url.searchParams.get("period") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    const doctorId = url.searchParams.get("doctorId") || undefined;
    const rows = async function* () {
      for await (const r of iterateSalesRows(clinicId, range, doctorId)) {
        yield [ymd(r.occurredAt), r.patientName ?? "", r.patientPhone ?? "", r.doctorName ?? "", r.gross, r.discount, r.net];
      }
    };
    return streamCsvResponse({
      filename: `sales-${range.from}_to_${range.to}`,
      headers: ["Date", "Patient", "Phone", "Doctor", "Gross", "Discount", "Net"],
      rows: rows(),
    });
  }

  if (type === "payments") {
    if (!hasSales || !can(user, "billing", "view")) return new Response("Forbidden", { status: 403 });
    const range = resolveSalesRange(url.searchParams.get("period") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    const filters = {
      from: range.start,
      toExclusive: range.end,
      doctorId: url.searchParams.get("doctorId") || undefined,
      method: url.searchParams.get("method") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      q: url.searchParams.get("q") || undefined,
    };
    const rows = async function* () {
      for await (const r of iteratePaymentsLedger(clinicId, filters)) {
        yield [ymd(r.occurredAt), r.patientName, r.patientPhone ?? "", r.doctorName ?? "", r.kind, r.method ?? "", r.reference ?? "", r.amount, isMoneyOut(r.kind) ? "out" : "in", r.createdByName ?? "", r.note ?? ""];
      }
    };
    return streamCsvResponse({
      filename: `payments-${range.from}_to_${range.to}`,
      headers: ["Date", "Patient", "Phone", "Doctor", "Type", "Method", "Reference", "Amount", "Direction", "By", "Note"],
      rows: rows(),
    });
  }

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
      ["Date", "Patient", "Doctor", "Type", "Value", "Amount", "Borne by", "Clinic bears", "Doctor bears", "Status", "Approved by"],
      report.rows.map((r) => [ymd(r.scheduledAt), r.patientName ?? "", r.doctorName ?? "", r.type, r.value, r.amount, r.borneBy, r.clinicBears, r.doctorBears, r.status, r.approvedBy ?? ""]),
    );
  } else if (type === "receivables") {
    if (!hasSales || !can(user, "receivables", "view")) return new Response("Forbidden", { status: 403 });
    // Receivables defaults to all-time (no date bound); a period narrows by visit date.
    const period = url.searchParams.get("period") ?? "";
    const range = period && period !== "all" ? resolveSalesRange(period, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined) : null;
    const report = await getReceivablesReport(clinicId, {
      doctorId: url.searchParams.get("doctorId") || undefined,
      q: url.searchParams.get("q") || undefined,
      from: range?.start,
      toExclusive: range?.end,
    });
    name = range ? `receivables-${range.from}_to_${range.to}` : "receivables-all";
    csv = toCsv(
      ["Patient", "Phone", "Visit date", "Doctor", "Bill", "Collected", "Outstanding"],
      report.patients.flatMap((p) =>
        p.visits.map((v) => [p.name, p.phone ?? "", ymd(v.scheduledAt), v.doctorName ?? "", v.bill, v.collected, v.outstanding]),
      ),
    );
  } else if (type === "invoices") {
    if (!hasSales || !can(user, "billing", "view")) return new Response("Forbidden", { status: 403 });
    const period = url.searchParams.get("period") ?? "";
    const range = period && period !== "all" ? resolveSalesRange(period, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined) : null;
    const list = await getInvoicesList(clinicId, {
      from: range?.start,
      toExclusive: range?.end,
      q: url.searchParams.get("q") || undefined,
    });
    name = range ? `invoices-${range.from}_to_${range.to}` : "invoices-all";
    csv = toCsv(
      ["Invoice", "Date", "Patient", "Phone", "Issued by", "Amount"],
      list.rows.map((r) => [r.label, ymd(r.issuedAt), r.patientName, r.patientPhone ?? "", r.issuedByName ?? "", r.amount]),
    );
  } else if (type === "shares") {
    if (!hasSales || !can(user, "shares", "view")) return new Response("Forbidden", { status: 403 });
    // Balances are lifetime (amount-based), so this export isn't range-bound — it
    // mirrors the page's per-doctor "By doctor" table. A doctorId narrows to one.
    const balances = await getDoctorBalances(clinicId, url.searchParams.get("doctorId") || undefined);
    name = "revenue-shares";
    csv = toCsv(
      ["Doctor", "Earned", "Discount adjustment", "Paid", "Outstanding"],
      balances.map((b) => [b.name, b.earned, b.borne + b.adjustments, b.paid, b.outstanding]),
    );
  } else if (type === "pl") {
    if (!hasFinance || !can(user, "finance", "view")) return new Response("Forbidden", { status: 403 });
    const range = resolveSalesRange(url.searchParams.get("period") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    const pl = await getProfitAndLoss(clinicId, range);
    name = `profit-loss-${range.from}_to_${range.to}`;
    const summary = toCsv(
      ["Metric", "Amount (PKR)"],
      [
        ["Collected revenue", pl.revenue],
        ["Doctor shares", pl.doctorShares],
        ["Expenses", pl.expenses],
        ["Net profit", pl.netProfit],
      ],
    );
    const byPeriod = toCsv(
      ["Period", "Revenue", "Costs", "Profit"],
      pl.plBuckets.map((b) => [b.label, b.revenue, b.share + b.expense, b.profit]),
    );
    csv = `Profit & Loss,${range.from} to ${range.to}\r\n\r\n${summary}\r\n\r\nBy period\r\n${byPeriod}`;
  } else {
    return new Response("Unknown report", { status: 400 });
  }

  // UTF-8 BOM so Excel opens Urdu/Arabic patient & clinic names correctly (matches
  // the P&L export); the brand credit is appended as a trailing line.
  const body = "﻿" + csv + `\r\n\r\n${BRAND_POWERED_BY}\r\n`;

  return new Response(body, {
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
