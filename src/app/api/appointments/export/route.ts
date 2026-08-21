import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { apiRequireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { streamCsvResponse } from "@/core/lib/csv-stream";
import {
  billFromTotals,
  effectiveDiscountValue,
} from "@/core/appointments/fee";
import {
  appointmentHasProceduresSql,
  appointmentProceduresGrossSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import { parseListFilters } from "@/core/appointments/list-filters";
import { buildAppointmentConds } from "@/core/appointments/list-query";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import { statusLabel } from "@/core/appointments/status";
import { displayStaffName } from "@/core/types/auth";

/**
 * GET /api/appointments/export?from=&to=&q=&status=&type=&payment=&session= — the
 * appointments list as a CSV, honouring the SAME filters as the list page. It STREAMS
 * via a keyset cursor (`(scheduled_at, id)`), one bounded batch at a time, so server
 * memory stays flat however many appointments match. Auth + clinic-scoped +
 * `appointments:view`. Amounts are raw numbers so Excel can sum them.
 */
export async function GET(req: Request) {
  const auth = await apiRequireWorkspace("appointments", "view");
  if (!auth.ok) return auth.response;
  const { user, clinicId } = auth;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());

  const { q, status, type, start, endExclusive, fromStr, toStr } = parseListFilters(sp);
  const session = typeof sp.session === "string" ? sp.session : "";

  const [clinicRow] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const billingOn = clinicHasFeature(clinicRow?.featuresEnabled, "sales");
  const payment = billingOn && typeof sp.payment === "string" ? sp.payment : "";

  // Every filter except the keyset cursor (added per batch below). Shared with
  // the list page + calendar so the CSV always matches what's on screen.
  // Same scope the screen applies — a doctor's download is their own schedule,
  // not the clinic's. Enforced here rather than trusted from the caller.
  const doctorId = appointmentDoctorScope(user);
  const baseConds = (): SQL[] =>
    buildAppointmentConds({ session, start, endExclusive, q, status, type, payment, doctorId });

  const typeLabel = (charge: boolean, hasProc: boolean): string => {
    if (charge && hasProc) return "Consultation + procedure";
    if (!charge && hasProc) return "Procedure";
    return "Consultation";
  };

  const BATCH = 5000;
  const rows = async function* () {
    let cursor: { ts: string; id: string } | null = null;
    for (;;) {
      const conds = baseConds();
      if (cursor) {
        // Full-precision text cursor (a JS Date truncates microseconds → skipped rows).
        conds.push(
          sql`(${appointments.scheduledAt} > ${cursor.ts}::timestamptz or (${appointments.scheduledAt} = ${cursor.ts}::timestamptz and ${appointments.id} > ${cursor.id}::uuid))`,
        );
      }
      const batch = await db
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
        .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)))
        .orderBy(asc(appointments.scheduledAt), asc(appointments.id))
        .limit(BATCH);

      for (const r of batch) {
        const { net } = billFromTotals(
          r.chargeConsultation ? (r.consultationFee ?? 0) : 0,
          Number(r.proceduresGross),
          Number(r.proceduresTotal),
          r.discountType === "percent" ? "percent" : "amount",
          effectiveDiscountValue(r.discountStatus, r.discountValue),
        );
        const doctor =
          r.doctorName || r.doctorUsername
            ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "")
            : "Any doctor";
        let pay = "";
        if (billingOn && r.status === "completed") {
          const collected = r.amountCollected ?? 0;
          pay = net <= 0 || collected >= net ? "Paid" : collected > 0 ? "Partial" : "Unpaid";
        }
        yield [
          dt(r.scheduledAt),
          r.queueNumber ?? "",
          r.patientName,
          r.patientPhone ?? "",
          doctor,
          statusLabel(r.status),
          typeLabel(r.chargeConsultation, Boolean(r.hasProcedures)),
          r.reason ?? "",
          net,
          r.amountCollected ?? 0,
          pay,
        ];
      }
      if (batch.length < BATCH) break;
      const lastRow = batch[batch.length - 1];
      cursor = { ts: lastRow.cursorTs, id: lastRow.id };
    }
  };

  return streamCsvResponse({
    filename: session ? "appointments-queue" : `appointments-${fromStr}_to_${toStr}`,
    headers: ["Date", "Token", "Patient", "Phone", "Doctor", "Status", "Type", "Reason", "Bill", "Collected", "Payment"],
    rows: rows(),
  });
}

function dt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
