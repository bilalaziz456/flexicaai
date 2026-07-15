import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments } from "@/core/db/schema";
import { getAppointmentShareContext } from "@/core/appointments/share-context";

/**
 * Billing view of an appointment — CORE (Finance). The **bill** the patient owes is
 * the approval-gated net (consultation + procedures − applicable discount), reused
 * from the share context so it can never drift from the split/quote. `collected` is
 * the denormalized cache on the appointment; the payment status is derived. A
 * pending/rejected discount is treated as not-applied (patient owes full) until
 * approved, consistent with the rest of the app.
 */

export type PaymentStatus = "not_billed" | "unpaid" | "partial" | "paid";

export type AppointmentBill = {
  found: boolean;
  status: string; // appointment status
  billTotal: number; // net the patient owes
  collected: number;
  outstanding: number;
  paymentStatus: PaymentStatus;
};

export async function getAppointmentBill(
  clinicId: string,
  appointmentId: string,
): Promise<AppointmentBill> {
  const [appt] = await db
    .select({
      status: appointments.status,
      amountCollected: appointments.amountCollected,
    })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt) {
    return {
      found: false,
      status: "",
      billTotal: 0,
      collected: 0,
      outstanding: 0,
      paymentStatus: "not_billed",
    };
  }

  const ctx = await getAppointmentShareContext(clinicId, appointmentId);
  const billTotal = Math.max(0, ctx.netEffective);
  const collected = appt.amountCollected;
  const outstanding = Math.max(0, billTotal - collected);
  const paymentStatus: PaymentStatus =
    appt.status !== "completed"
      ? "not_billed"
      : outstanding <= 0
        ? "paid"
        : collected > 0
          ? "partial"
          : "unpaid";

  return { found: true, status: appt.status, billTotal, collected, outstanding, paymentStatus };
}
