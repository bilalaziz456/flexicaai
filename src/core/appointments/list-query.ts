import "server-only";

import { eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { appointments, patients, users } from "@/core/db/schema";
import {
  appointmentHasProceduresSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
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

/**
 * A visit's NET bill: (consultation when charged) + procedures − the
 * approval-gated appointment discount. Mirrors `computeAppointmentTotal` /
 * `computeBill` exactly so the DB filter and the rendered figure can't drift; a
 * 'pending'/'rejected' discount counts as 0 until approved.
 */
export function appointmentNetSql(): SQL<number> {
  const effDiscount = sql`(case when ${appointments.discountStatus} in ('pending','rejected') then 0 else ${appointments.discountValue} end)`;
  const subtotal = sql`((case when ${appointments.chargeConsultation} then coalesce(${users.consultationFee}, 0) else 0 end) + ${appointmentProceduresNetSql()})`;
  return sql<number>`(${subtotal} - least(greatest(case when ${appointments.discountType} = 'percent' then round(${subtotal} * ${effDiscount} / 100.0) else ${effDiscount} end, 0), ${subtotal}))`;
}

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
