import type { listClinicAppointments } from "@/core/appointments/list-query";
import {
  billFromTotals,
  effectiveDiscountValue,
  formatPkr,
} from "@/core/appointments/fee";
import { displayStaffName } from "@/core/types/auth";
import {
  paymentStatusBadge,
  visitPaymentStatus,
  type PaymentBadgeVariant,
} from "@/core/billing/payment-status";

/**
 * How one appointment row reads — shared by the list and its A4 print, so the
 * printed sheet can never show a different fee, type or payment state from the
 * screen it was printed from.
 */
export type AppointmentRow = Awaited<ReturnType<typeof listClinicAppointments>>["rows"][number];

export const formatWhen = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const appointmentDoctorLabel = (a: AppointmentRow) =>
  a.doctorName || a.doctorUsername
    ? displayStaffName(a.doctorPrefix, a.doctorName, a.doctorUsername ?? "")
    : "Any doctor";

const billOf = (a: AppointmentRow) =>
  // gross is the TRUE pre-discount figure: passing only the NET made the
  // struck-through "full price" understate whenever a line carried a discount,
  // so the row disagreed with the invoice it prints.
  billFromTotals(
    a.chargeConsultation ? a.consultationFee : 0,
    Number(a.proceduresGross),
    Number(a.proceduresTotal),
    a.discountType === "percent" ? "percent" : "amount",
    effectiveDiscountValue(a.discountStatus, a.discountValue),
  );

export function appointmentFeeLabel(
  a: AppointmentRow,
): { net: string; discounted: boolean; full: string } | null {
  const { gross, discount, net } = billOf(a);
  if (gross === 0) return null;
  return { net: formatPkr(net), discounted: discount > 0, full: formatPkr(gross) };
}

/**
 * The payment badge — six derived states (`core/billing/payment-status.ts`): Not paid,
 * Advance paid, Partially paid, Paid, Refund due, Refunded. Shown on EVERY visit,
 * not just completed ones: an advance taken before the visit is the case the old
 * completed-only badge could not show. Null when billing is off or there is nothing to
 * say (no bill, nothing taken).
 */
export function appointmentPayLabel(
  a: AppointmentRow,
  billingOn: boolean,
): { label: string; variant: PaymentBadgeVariant } | null {
  if (!billingOn) return null;
  const bill = billOf(a).net;
  const status = visitPaymentStatus({
    bill,
    collected: a.amountCollected,
    refunded: Number(a.refunded ?? 0),
    visitStatus: a.status,
  });
  if (!status) return null;
  return paymentStatusBadge(status, {
    outstanding: Math.max(0, bill - a.amountCollected),
    visitStatus: a.status,
    formatMoney: formatPkr,
  });
}

/** "Created by": WhatsApp for a patient's self-booking, else the staff member who
 *  booked it (a name snapshot), or null when nothing recorded it (bookings made before
 *  the column, with no activity-log entry to recover it from). */
export function appointmentCreatedByLabel(a: AppointmentRow): string | null {
  if (a.source === "whatsapp") return "WhatsApp";
  return a.createdByName ?? null;
}

/** What the visit is FOR: consultation (fee, no procedures) · procedure (procedures,
 *  consultation not charged) · both. Mirrors the `type` filter's SQL derivation. */
export function appointmentTypeInfo(
  a: AppointmentRow,
): { label: string; variant: "default" | "secondary" | "outline" } {
  if (a.hasProcedures && a.chargeConsultation) return { label: "Both", variant: "default" };
  if (a.hasProcedures) return { label: "Procedure", variant: "secondary" };
  return { label: "Consultation", variant: "outline" };
}
