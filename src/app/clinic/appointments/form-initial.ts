import type { AppointmentProcedureItem } from "@/core/appointments/procedures";
import { normalizeDiscountType } from "@/core/appointments/fee";

/**
 * A saved visit's lines and consultation discount in the shape the booking form's
 * `initial` takes — shared by the appointment page and the invoice page, which both
 * edit a visit through that form, so an edit keeps every line's own discount and its
 * bearer (docs/per-line-discount-plan.md §8) instead of one page silently dropping it.
 */
export function formInitialLines(
  items: AppointmentProcedureItem[],
  appt: {
    consultationDiscountType: string;
    consultationDiscountValue: number;
    consultationBorneBy: string;
    consultationSplitType: string;
    consultationSplitValue: number;
  },
) {
  return {
    procedures: items
      .filter((i): i is typeof i & { procedureId: string } => Boolean(i.procedureId))
      .map((i) => ({
        procedureId: i.procedureId,
        quantity: i.quantity,
        discountType: i.discountType,
        discountValue: i.discountValue,
        unitPrice: i.unitPrice,
        listPrice: i.listPrice,
        patientDiscount: {
          type: i.patientDiscountType,
          value: i.patientDiscountValue,
          borneBy: i.discountBorneBy,
          split: i.discountSplit,
          fromPlan: i.discountFromPlan,
        },
      })),
    // Kept on an edit: a one-off charge has no list item to re-select.
    otherCharges: items
      .filter((i) => !i.procedureId && i.isService)
      .map((i) => ({
        name: i.name,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        discountType: i.patientDiscountType,
        discountValue: i.patientDiscountValue,
      })),
    consultationDiscount: {
      type: normalizeDiscountType(appt.consultationDiscountType),
      value: appt.consultationDiscountValue,
      borneBy: appt.consultationBorneBy === "doctor" || appt.consultationBorneBy === "split" ? appt.consultationBorneBy : "clinic",
      split: {
        type: normalizeDiscountType(appt.consultationSplitType),
        value: appt.consultationSplitValue,
      },
    } as const,
  };
}
