import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointmentProcedures, sales, users } from "@/core/db/schema";

export type SalesGranularity = "hour" | "day" | "week" | "month";
export type SalesPeriod = "today" | "30d" | "quarter" | "half" | "year" | "custom";

export type SalesBucket = { label: string; value: number };
export type DoctorSales = {
  doctorId: string | null;
  name: string;
  net: number;
  count: number;
};
export type ProcedureSales = { name: string; gross: number; qty: number };

export type SalesReport = {
  netTotal: number;
  discountTotal: number;
  grossTotal: number;
  count: number;
  avgNet: number;
  granularity: SalesGranularity;
  buckets: SalesBucket[];
  byDoctor: DoctorSales[];
  byProcedure: ProcedureSales[];
};

export type ResolvedRange = {
  period: SalesPeriod;
  start: Date;
  end: Date; // exclusive
  granularity: SalesGranularity;
  from: string; // YYYY-MM-DD (inclusive first day) — drives the date pickers
  to: string; // YYYY-MM-DD (inclusive last day)
};

/** Local-time YYYY-MM-DD (matches the rest of the app's server-local convention). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Chooses a sensible bucket size for a span so the chart never has too many bars. */
function granularityForSpan(days: number): SalesGranularity {
  if (days <= 2) return "hour";
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

/**
 * Turns a period preset (or a custom from/to) into a concrete [start, end) range
 * plus the chart's bucket size. All local-time. Presets are "last N days" ending
 * today; custom parses the two date strings. Invalid custom dates fall back to 30d.
 */
export function resolveSalesRange(
  period: string | undefined,
  fromStr: string | undefined,
  toStr: string | undefined,
): ResolvedRange {
  const p = (period ?? "30d") as SalesPeriod;
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  const preset = (days: number, granularity: SalesGranularity): ResolvedRange => {
    const start = addDays(today, -(days - 1));
    return {
      period: p,
      start,
      end: tomorrow,
      granularity,
      from: ymd(start),
      to: ymd(today),
    };
  };

  switch (p) {
    case "today":
      return preset(1, "hour");
    case "quarter":
      return preset(90, "week");
    case "half":
      return preset(180, "week");
    case "year":
      return preset(365, "month");
    case "custom": {
      const okFrom = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr);
      const okTo = toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr);
      if (okFrom && okTo) {
        const [fy, fm, fd] = fromStr!.split("-").map(Number);
        const [ty, tm, td] = toStr!.split("-").map(Number);
        let start = new Date(fy, fm - 1, fd);
        let endInclusive = new Date(ty, tm - 1, td);
        // Guard against a reversed range.
        if (endInclusive < start) [start, endInclusive] = [endInclusive, start];
        const end = addDays(startOfDay(endInclusive), 1);
        const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000);
        return {
          period: "custom",
          start,
          end,
          granularity: granularityForSpan(spanDays),
          from: ymd(start),
          to: ymd(endInclusive),
        };
      }
      return preset(30, "day");
    }
    case "30d":
    default:
      return preset(30, "day");
  }
}

function startOfBucket(d: Date, g: SalesGranularity): Date {
  const x = new Date(d);
  x.setMilliseconds(0);
  x.setSeconds(0);
  x.setMinutes(0);
  if (g === "hour") return x;
  x.setHours(0);
  if (g === "day") return x;
  if (g === "week") {
    // Week starts Monday.
    const dow = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - dow);
    return x;
  }
  x.setDate(1); // month
  return x;
}

function nextBucket(d: Date, g: SalesGranularity): Date {
  const x = new Date(d);
  if (g === "hour") x.setHours(x.getHours() + 1);
  else if (g === "day") x.setDate(x.getDate() + 1);
  else if (g === "week") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
}

function bucketLabel(d: Date, g: SalesGranularity): string {
  if (g === "hour")
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (g === "month")
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * The Sales report for a clinic over a resolved range, optionally scoped to one
 * doctor. CORE + clinic-scoped. One fetch of the range's sale rows powers the
 * summary, the time buckets and the per-doctor split (kept in local time to match
 * the range); a second query joins the appointment line items for the procedure
 * mix. The range is bounded, and (`clinic_id`,`occurred_at`) is indexed.
 */
export async function getSalesReport(
  clinicId: string,
  range: ResolvedRange,
  doctorId?: string | null,
): Promise<SalesReport> {
  const { start, end, granularity } = range;

  const doctorFilter = doctorId ? eq(sales.doctorId, doctorId) : undefined;

  const rows = await db
    .select({
      doctorId: sales.doctorId,
      doctorName: sales.doctorName,
      grossAmount: sales.grossAmount,
      discountAmount: sales.discountAmount,
      netAmount: sales.netAmount,
      occurredAt: sales.occurredAt,
    })
    .from(sales)
    .where(
      byClinic(
        sales.clinicId,
        clinicId,
        and(gte(sales.occurredAt, start), lt(sales.occurredAt, end), doctorFilter),
      ),
    )
    .orderBy(asc(sales.occurredAt));

  // Pre-build every bucket in the range so the chart shows empty periods too.
  const buckets: { t: number; label: string; value: number }[] = [];
  const bucketIndex = new Map<number, number>();
  for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
    bucketIndex.set(cur.getTime(), buckets.length);
    buckets.push({ t: cur.getTime(), label: bucketLabel(cur, granularity), value: 0 });
  }

  let netTotal = 0;
  let discountTotal = 0;
  let grossTotal = 0;
  const doctorMap = new Map<string, DoctorSales>();

  for (const r of rows) {
    netTotal += r.netAmount;
    discountTotal += r.discountAmount;
    grossTotal += r.grossAmount;

    const bt = startOfBucket(r.occurredAt, granularity).getTime();
    const bi = bucketIndex.get(bt);
    if (bi !== undefined) buckets[bi].value += r.netAmount;

    const key = r.doctorId ?? "__none__";
    const existing = doctorMap.get(key);
    if (existing) {
      existing.net += r.netAmount;
      existing.count += 1;
    } else {
      doctorMap.set(key, {
        doctorId: r.doctorId,
        name: r.doctorName ?? "Unassigned",
        net: r.netAmount,
        count: 1,
      });
    }
  }

  const byDoctor = [...doctorMap.values()].sort((a, b) => b.net - a.net);

  // Procedure mix (gross line-item revenue, pre-discount) over the same window.
  const procRows = await db
    .select({
      name: appointmentProcedures.name,
      gross: sql<number>`sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})::int`,
      qty: sql<number>`sum(${appointmentProcedures.quantity})::int`,
    })
    .from(appointmentProcedures)
    .innerJoin(sales, eq(sales.appointmentId, appointmentProcedures.appointmentId))
    .where(
      byClinic(
        appointmentProcedures.clinicId,
        clinicId,
        and(gte(sales.occurredAt, start), lt(sales.occurredAt, end), doctorFilter),
      ),
    )
    .groupBy(appointmentProcedures.name)
    .orderBy(desc(sql`sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity})`));

  const byProcedure: ProcedureSales[] = procRows.map((r) => ({
    name: r.name,
    gross: Number(r.gross),
    qty: Number(r.qty),
  }));

  const count = rows.length;
  return {
    netTotal,
    discountTotal,
    grossTotal,
    count,
    avgNet: count > 0 ? Math.round(netTotal / count) : 0,
    granularity,
    buckets: buckets.map((b) => ({ label: b.label, value: b.value })),
    byDoctor,
    byProcedure,
  };
}

/** Clinic's doctors for the report's doctor filter (id + display name). */
export async function getSalesDoctors(
  clinicId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.role, "doctor")))
    .orderBy(asc(users.fullName));
  return rows.map((r) => ({ id: r.id, name: r.fullName ?? r.username }));
}
