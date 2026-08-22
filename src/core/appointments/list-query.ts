import "server-only";

import { and, asc, count, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import {
  appointmentHasProceduresSql,
  appointmentProceduresGrossSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import type { StatusFilter, VisitTypeFilter } from "./list-filters";

/**
 * The appointment list's filter SQL, in ONE place — the list page, the CSV
 * export and the month calendar all narrow appointments identically. Previously
 * this block was copy-pasted between the first two; the calendar needs the same
 * conditions over a different date range, which would have made a third copy.
 *
 * Callers own the FROM/JOIN shape: every query using these conditions must
 * `innerJoin(patients)` and `leftJoin(users)` (the search and net-bill SQL
 * reference both), and wrap the result in `byClinic(...)` + `notDeleted(...)`.
 */


export type AppointmentFilterInput = {
  /** A queue session pins doctor + day + window; it replaces the date range. */
  session?: string;
  start: Date;
  endExclusive: Date;
  q?: string;
  status?: StatusFilter;
  type?: VisitTypeFilter;
  /** "" | "paid" | "partial" | "unpaid" — only meaningful when the clinic bills. */
  payment?: string;
  /** Narrow to one doctor. Set from `appointmentDoctorScope`, not from the URL —
   *  it's a viewer's scope, not something they choose. */
  doctorId?: string;
};

/**
 * Every list filter as SQL conditions. A queue session pins the doctor/day/window
 * so it replaces the date range; the rest narrow either view.
 */
export function buildAppointmentConds(f: AppointmentFilterInput): SQL[] {
  const conds: SQL[] = f.session
    ? [eq(appointments.queueSession, f.session)]
    : [
        gte(appointments.scheduledAt, f.start),
        lt(appointments.scheduledAt, f.endExclusive),
      ];

  if (f.q) {
    conds.push(
      or(ilike(patients.fullName, `%${f.q}%`), ilike(patients.phone, `%${f.q}%`))!,
    );
  }
  if (f.status) conds.push(eq(appointments.status, f.status));
  // Applies even inside a queue session, so a doctor opening someone else's
  // queue key by hand still only sees their own patients.
  if (f.doctorId) conds.push(eq(appointments.doctorId, f.doctorId));

  // Visit type = consultation (fee, no procedures) · procedure (procedures, fee not
  // charged) · both (fee + procedures). Derived from charge_consultation + procedures.
  if (f.type) {
    const hasProc = appointmentHasProceduresSql();
    if (f.type === "both") {
      conds.push(sql`${appointments.chargeConsultation} = true and ${hasProc}`);
    } else if (f.type === "procedure") {
      conds.push(sql`${appointments.chargeConsultation} = false and ${hasProc}`);
    } else if (f.type === "consultation") {
      conds.push(sql`not ${hasProc}`);
    }
  }

  // Payment status only applies to a completed visit that actually has a bill.
  if (f.payment) {
    const net = appointmentNetSql();
    if (f.payment === "paid") {
      conds.push(sql`${appointments.status} = 'completed' and (${net} <= 0 or ${appointments.amountCollected} >= ${net})`);
    } else if (f.payment === "partial") {
      conds.push(sql`${appointments.status} = 'completed' and ${net} > 0 and ${appointments.amountCollected} > 0 and ${appointments.amountCollected} < ${net}`);
    } else if (f.payment === "unpaid") {
      conds.push(sql`${appointments.status} = 'completed' and ${net} > 0 and ${appointments.amountCollected} = 0`);
    }
  }

  return conds;
}

/**
 * One appointment with its patient, for the detail page — CORE per ADR-014.
 *
 * Every field the detail view reads, in one clinic-scoped query. The DISCOUNT columns
 * come along because the read-only bill is derived from them at render (`computeBill`),
 * not stored — see ADR-015.
 */
export async function getAppointmentDetail(clinicId: string, appointmentId: string) {
  const [row] = await db
    .select({
      id: appointments.id,
      doctorId: appointments.doctorId,
      scheduledAt: appointments.scheduledAt,
      durationMinutes: appointments.durationMinutes,
      status: appointments.status,
      reason: appointments.reason,
      source: appointments.source,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountBorneBy: appointments.discountBorneBy,
      discountSplitType: appointments.discountSplitType,
      discountSplitValue: appointments.discountSplitValue,
      discountStatus: appointments.discountStatus,
      chargeConsultation: appointments.chargeConsultation,
      patientId: patients.id,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * One page of the appointments list, plus its total — CORE per ADR-014.
 *
 * The bill columns come from `appointmentProcedures*Sql`, so the list, the invoice and
 * the reports all aggregate the SAME expression (ADR-015) rather than three that
 * happen to agree today.
 *
 * ORDER depends on the view: a QUEUE view sorts by token number, because that is the
 * order patients are actually seen in; every other view sorts by time. Sorting a queue
 * by clock time would show the list in an order the waiting room disagrees with.
 */
export async function listClinicAppointments(
  clinicId: string,
  conds: (SQL | undefined)[],
  paging: { offset: number; limit: number },
  opts: { byQueueNumber?: boolean } = {},
) {
  // Tenant scoping and the soft-delete filter belong HERE, not at the call site — the
  // page supplies only what the user filtered by (`buildAppointmentConds`).
  const where = byClinic(
    appointments.clinicId,
    clinicId,
    notDeleted(appointments.deletedAt),
    and(...conds),
  );
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduledAt,
        status: appointments.status,
        reason: appointments.reason,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        chargeConsultation: appointments.chargeConsultation,
        amountCollected: appointments.amountCollected,
        queueNumber: appointments.queueNumber,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        doctorName: users.fullName,
        doctorUsername: users.username,
        doctorPrefix: users.prefix,
        consultationFee: users.consultationFee,
        proceduresGross: appointmentProceduresGrossSql(),
        proceduresTotal: appointmentProceduresNetSql(),
        hasProcedures: appointmentHasProceduresSql(),
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(where)
      .orderBy(opts.byQueueNumber ? asc(appointments.queueNumber) : asc(appointments.scheduledAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db
      .select({ total: count() })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(where),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}

/**
 * One keyset batch of the appointments export — CORE per ADR-014.
 *
 * KEYSET, not offset: a CSV of a busy clinic's whole history walks the table, and an
 * OFFSET scan re-reads everything before the cursor on each page. The cursor is
 * `(scheduled_at, id)` because timestamps repeat and a bare timestamp cursor would
 * skip or duplicate rows at a boundary.
 *
 * The cursor timestamp is TEXT at FULL precision on purpose: round-tripping it through
 * a JS `Date` truncates microseconds, which silently drops every row inside the
 * truncated instant — the kind of loss a CSV cannot show you.
 */
export async function listAppointmentExportBatch(
  clinicId: string,
  conds: (SQL | undefined)[],
  cursor: { ts: string; id: string } | null,
  batchSize: number,
) {
  const all = [...conds];
  if (cursor) {
    all.push(
      sql`(${appointments.scheduledAt} > ${cursor.ts}::timestamptz or (${appointments.scheduledAt} = ${cursor.ts}::timestamptz and ${appointments.id} > ${cursor.id}::uuid))`,
    );
  }
  return db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      cursorTs: sql<string>`${appointments.scheduledAt}::text`,
      status: appointments.status,
      reason: appointments.reason,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      chargeConsultation: appointments.chargeConsultation,
      amountCollected: appointments.amountCollected,
      queueNumber: appointments.queueNumber,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      consultationFee: users.consultationFee,
      proceduresGross: appointmentProceduresGrossSql(),
      proceduresTotal: appointmentProceduresNetSql(),
      hasProcedures: appointmentHasProceduresSql(),
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...all)))
    .orderBy(asc(appointments.scheduledAt), asc(appointments.id))
    .limit(batchSize);
}
