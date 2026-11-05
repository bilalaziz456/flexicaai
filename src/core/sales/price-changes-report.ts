import "server-only";

import { and, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentProcedures, appointments, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";

export type PriceChangeRow = {
  /** The line's own id — one visit may have several changed lines. */
  key: string;
  appointmentId: string;
  scheduledAt: Date;
  patientName: string | null;
  doctorName: string | null;
  name: string;
  isService: boolean;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  /** (charged − list) × quantity: positive when raised, negative when lowered. */
  difference: number;
};

export type PriceChangesReport = {
  rows: PriceChangeRow[]; // ONE PAGE — `count` is the full match
  count: number;
  raised: number; // Σ positive differences
  lowered: number; // Σ negative differences, as a positive number
};

/**
 * Price changes (Finance → Discounts page) — every procedure or service line charged
 * at a price other than its list price, on a visit in the range (docs/line-price-plan.md
 * §3). A lower price is not a discount, so it is not in the Discounts report; this is
 * where it stays visible. Lines from before `0140` have no list price and never show.
 * Clinic-scoped.
 */
export async function getPriceChangesReport(
  clinicId: string,
  range: ResolvedRange,
  filters: { doctorId?: string | null } = {},
  paging: { offset: number; limit: number } = { offset: 0, limit: 200 },
): Promise<PriceChangesReport> {
  const where = byClinic(
    appointmentProcedures.clinicId,
    clinicId,
    and(
      isNotNull(appointmentProcedures.listPrice),
      ne(appointmentProcedures.unitPrice, sql`${appointmentProcedures.listPrice}`),
      gte(appointments.scheduledAt, range.start),
      lt(appointments.scheduledAt, range.end),
      notDeleted(appointments.deletedAt),
      filters.doctorId ? eq(appointments.doctorId, filters.doctorId) : undefined,
    ),
  );
  // Each line's difference, in numeric (ADR-021): price × quantity can pass int4.
  const diff = sql`((${appointmentProcedures.unitPrice}::numeric - ${appointmentProcedures.listPrice}) * ${appointmentProcedures.quantity})`;

  const rows = await db
    .select({
      key: appointmentProcedures.id,
      appointmentId: appointments.id,
      scheduledAt: appointments.scheduledAt,
      patientName: patients.fullName,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      name: appointmentProcedures.name,
      isService: appointmentProcedures.isService,
      quantity: appointmentProcedures.quantity,
      listPrice: appointmentProcedures.listPrice,
      unitPrice: appointmentProcedures.unitPrice,
      difference: sql<number>`${diff}::int`,
    })
    .from(appointmentProcedures)
    .innerJoin(appointments, eq(appointments.id, appointmentProcedures.appointmentId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(where)
    .orderBy(desc(appointments.scheduledAt), appointmentProcedures.name)
    .limit(paging.limit)
    .offset(paging.offset);

  // Totals over the whole match, in SQL — not folded from one page (ADR-024).
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      raised: sql<number>`coalesce(sum(greatest(${diff}, 0)), 0)::int`,
      lowered: sql<number>`coalesce(sum(greatest(-${diff}, 0)), 0)::int`,
    })
    .from(appointmentProcedures)
    .innerJoin(appointments, eq(appointments.id, appointmentProcedures.appointmentId))
    .where(where);

  return {
    rows: rows.map((r) => ({
      key: r.key,
      appointmentId: r.appointmentId,
      scheduledAt: r.scheduledAt,
      patientName: r.patientName,
      doctorName:
        r.doctorName || r.doctorUsername ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "") : null,
      name: r.name,
      isService: r.isService,
      quantity: r.quantity,
      listPrice: r.listPrice ?? r.unitPrice,
      unitPrice: r.unitPrice,
      difference: Number(r.difference),
    })),
    count: totals?.count ?? 0,
    raised: totals?.raised ?? 0,
    lowered: totals?.lowered ?? 0,
  };
}
