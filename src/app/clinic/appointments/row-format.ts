import type { listClinicAppointments } from "@/core/appointments/list-query";
import {
  billFromTotals,
  effectiveDiscountValue,
  formatPkr,
} from "@/core/appointments/fee";
import { displayStaffName } from "@/core/types/auth";

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

/** Payment status of a completed visit (bill vs collected). Null when billing is
 *  off or the visit isn't completed / has no bill. */
export function appointmentPayLabel(
  a: AppointmentRow,
  billingOn: boolean,
): { label: string; variant: "outline" | "secondary" | "destructive" } | null {
  if (!billingOn || a.status !== "completed") return null;
  const bill = billOf(a).net;
  if (bill <= 0) return null;
  const left = bill - a.amountCollected;
  if (left <= 0) return { label: "Paid", variant: "outline" };
  if (a.amountCollected > 0) return { label: `Partial · ${formatPkr(left)} left`, variant: "secondary" };
  return { label: "Unpaid", variant: "destructive" };
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
