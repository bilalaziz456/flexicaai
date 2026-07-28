import "server-only";

import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentProcedures, appointments, patients, sales, users } from "@/core/db/schema";
import { procedureRowNetSql } from "@/core/appointments/procedures";

export type SalesGranularity = "hour" | "day" | "week" | "month";
export type SalesPeriod = "today" | "30d" | "quarter" | "half" | "year" | "all" | "custom";

/** Floor for an "all time" range when the caller can't supply the real earliest
 *  date (e.g. a cross-clinic admin view). Safely before any Klenic data (the app
 *  launched mid-2026) while keeping the monthly bucket count reasonable. Per-clinic
 *  callers pass the clinic's `createdAt` for an exact, chart-clean start. */
const ALL_TIME_FLOOR = new Date(2024, 0, 1);

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
  earliest?: Date,
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
    case "all": {
      // Everything to date. Start at the caller's earliest known date (e.g. the
      // clinic's creation) so charts don't show years of empty buckets; fall back to
      // a safe floor. Monthly buckets keep even a multi-year span readable.
      const start = startOfDay(earliest && earliest < today ? earliest : ALL_TIME_FLOOR);
      return {
        period: "all",
        start,
        end: tomorrow,
        granularity: "month",
        from: ymd(start),
        to: ymd(today),
      };
    }
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

export function startOfBucket(d: Date, g: SalesGranularity): Date {
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

export function nextBucket(d: Date, g: SalesGranularity): Date {
  const x = new Date(d);
  if (g === "hour") x.setHours(x.getHours() + 1);
  else if (g === "day") x.setDate(x.getDate() + 1);
  else if (g === "week") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
}

export function bucketLabel(d: Date, g: SalesGranularity): string {
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

  // Procedure mix — net line-item revenue (after each line's own discount, before
  // the appointment-level discount) over the same window.
  const netExpr = procedureRowNetSql();
  const procRows = await db
    .select({
      name: appointmentProcedures.name,
      gross: sql<number>`sum(${netExpr})::int`,
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
    .orderBy(desc(sql`sum(${netExpr})`));

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

/**
 * Lightweight net-sales summary over a range (net total + completed-visit count) —
 * for the clinic dashboard card, without the report's buckets/breakdowns. Uses the
 * (`clinic_id`,`occurred_at`) index. Clinic-scoped.
 */
export async function getSalesSummary(
  clinicId: string,
  range: ResolvedRange,
): Promise<{ netTotal: number; count: number }> {
  const [row] = await db
    .select({
      net: sql<number>`coalesce(sum(${sales.netAmount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      byClinic(
        sales.clinicId,
        clinicId,
        and(gte(sales.occurredAt, range.start), lt(sales.occurredAt, range.end)),
      ),
    );
  return { netTotal: Number(row?.net ?? 0), count: Number(row?.count ?? 0) };
}

export type SalesLedgerRow = {
  occurredAt: Date;
  patientName: string | null;
  patientPhone: string | null;
  doctorName: string | null;
  gross: number;
  discount: number;
  net: number;
};

/**
 * Row-level sale ledger for a range (one row per completed, paid visit) — powers the
 * Sales CSV export. Joins the appointment's patient for the name/phone; the doctor is
 * the ledger's snapshot. Same range + doctor filter as `getSalesReport`, clinic-scoped,
 * ordered oldest-first. The (`clinic_id`,`occurred_at`) index bounds the scan.
 */
export async function listSalesRows(
  clinicId: string,
  range: ResolvedRange,
  doctorId?: string | null,
): Promise<SalesLedgerRow[]> {
  const doctorFilter = doctorId ? eq(sales.doctorId, doctorId) : undefined;
  return db
    .select({
      occurredAt: sales.occurredAt,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      doctorName: sales.doctorName,
      gross: sales.grossAmount,
      discount: sales.discountAmount,
      net: sales.netAmount,
    })
    .from(sales)
    .innerJoin(appointments, eq(appointments.id, sales.appointmentId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      byClinic(
        sales.clinicId,
        clinicId,
        and(gte(sales.occurredAt, range.start), lt(sales.occurredAt, range.end), doctorFilter),
      ),
    )
    .orderBy(asc(sales.occurredAt));
}

/**
 * Streaming variant of `listSalesRows` — yields the same rows in creation order but
 * pages through them with a KEYSET cursor (`(occurred_at, id)`), one bounded batch
 * at a time, so a huge export never loads the whole table into memory. Used by the
 * streaming CSV export. Clinic-scoped; the (`clinic_id`,`occurred_at`) index serves
 * each page.
 */
export async function* iterateSalesRows(
  clinicId: string,
  range: ResolvedRange,
  doctorId?: string | null,
  batchSize = 5000,
): AsyncGenerator<SalesLedgerRow> {
  const doctorFilter = doctorId ? eq(sales.doctorId, doctorId) : undefined;
  // Kept as its own function so its (concrete) result type doesn't depend on the
  // loop's cursor — otherwise the batch/cursor types infer circularly.
  const page = (keyset: SQL | undefined) =>
    db
      .select({
        id: sales.id,
        occurredAt: sales.occurredAt,
        // Full-precision timestamp as text for the cursor: a JS Date only has
        // millisecond precision, so a truncated cursor would skip rows that share a
        // millisecond. The text round-trips losslessly through `::timestamptz`.
        cursorTs: sql<string>`${sales.occurredAt}::text`,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        doctorName: sales.doctorName,
        gross: sales.grossAmount,
        discount: sales.discountAmount,
        net: sales.netAmount,
      })
      .from(sales)
      .innerJoin(appointments, eq(appointments.id, sales.appointmentId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        byClinic(
          sales.clinicId,
          clinicId,
          and(gte(sales.occurredAt, range.start), lt(sales.occurredAt, range.end), doctorFilter, keyset),
        ),
      )
      .orderBy(asc(sales.occurredAt), asc(sales.id))
      .limit(batchSize);

  let cursor: { ts: string; id: string } | null = null;
  for (;;) {
    const keyset: SQL | undefined = cursor
      ? sql`(${sales.occurredAt} > ${cursor.ts}::timestamptz or (${sales.occurredAt} = ${cursor.ts}::timestamptz and ${sales.id} > ${cursor.id}::uuid))`
      : undefined;

    const batch = await page(keyset);

    for (const r of batch) {
      yield {
        occurredAt: r.occurredAt,
        patientName: r.patientName,
        patientPhone: r.patientPhone,
        doctorName: r.doctorName,
        gross: r.gross,
        discount: r.discount,
        net: r.net,
      };
    }
    if (batch.length < batchSize) break;
    const lastRow = batch[batch.length - 1];
    cursor = { ts: lastRow.cursorTs, id: lastRow.id };
  }
}

/** Clinic's doctors for the report's doctor filter (id + display name). */
export async function getSalesDoctors(
  clinicId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        eq(users.role, "doctor"),
      ),
    )
    .orderBy(asc(users.fullName));
  return rows.map((r) => ({ id: r.id, name: r.fullName ?? r.username }));
}
