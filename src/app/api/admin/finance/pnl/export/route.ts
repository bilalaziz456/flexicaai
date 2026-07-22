import { NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { getCompanyPnl } from "@/core/admin/pnl";
import { resolveSalesRange } from "@/core/sales/report";
import { toCsv } from "@/core/lib/csv";

/**
 * GET /api/admin/finance/pnl/export?period=…&from=…&to=… — the company P&L for the
 * period as a CSV (summary + per-clinic margin + trend) for the accountant. Route
 * handler → 403 (not redirect) when the caller lacks `finance:view`. UTF-8 BOM so
 * Excel opens Urdu/Arabic clinic names correctly.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin" || !canAdmin(user, "finance:view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const range = resolveSalesRange(
    url.searchParams.get("period") ?? "30d",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const pnl = await getCompanyPnl(range);

  const summary = toCsv(
    ["Metric", "Amount (PKR)"],
    [
      ["Collected revenue", pnl.revenue],
      ["Serving cost", pnl.servingCost],
      ["Operating expenses", pnl.operatingExpenses],
      ["Gross margin", pnl.grossMargin],
      ["Net profit", pnl.netProfit],
      ["Margin %", pnl.marginPct ?? ""],
      ["MRR (run-rate)", pnl.mrr],
      ["ARR (run-rate)", pnl.arr],
    ],
  );
  const perClinic = toCsv(
    ["Clinic", "Collected revenue", "Serving cost", "Margin"],
    pnl.perClinic.map((c) => [c.name, c.revenue, c.servingCost, c.margin]),
  );
  const trend = toCsv(
    ["Period", "Revenue", "Cost", "Net profit"],
    pnl.trend.map((b) => [b.label, b.revenue, b.cost, b.netProfit]),
  );

  const csv =
    `Company P&L,${range.from} to ${range.to}\r\n\r\n` +
    `${summary}\r\n\r\nPer-clinic margin\r\n${perClinic}\r\n\r\nTrend\r\n${trend}\r\n`;

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="company-pnl-${range.from}_to_${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
