import "server-only";

import { z } from "zod";
import { localDateStr } from "@/core/appointments/availability";
import { MAX_DISCOUNT_PERCENT } from "@/core/appointments/fee";
import type { ProcedureOffer } from "@/core/appointments/procedure-offer";
import { zodErrorMessage } from "@/core/lib/zod-error";

/**
 * The clinic-offer form (type, value, start, end / no end), checked — shared by the
 * Procedures and Services pages, which set offers through the same dialog (owner's
 * call, 2026-10-18), so one list cannot accept an offer the other would refuse.
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const offerSchema = z
  .object({
    type: z.enum(["amount", "percent"]),
    value: z.coerce
      .number({ message: "Enter the offer amount." })
      .int("Whole numbers only.")
      .min(1, "Enter an offer above 0."),
    // Required (owner's call): an offer always says when it began, so the Procedures
    // page and the audit log can both answer "since when?".
    startsOn: z
      .string()
      .trim()
      .min(1, "Pick a start date.")
      .regex(YMD, "Invalid start date."),
    endsOn: z
      .string()
      .trim()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || YMD.test(v), { message: "Invalid end date." }),
    noEnd: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "percent" && v.value > MAX_DISCOUNT_PERCENT) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage offer can't be more than 100%." });
    }
    if (!v.noEnd && !v.endsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: 'Pick an end date, or tick "No end date".' });
    }
    if (!v.noEnd && v.endsOn && v.startsOn && v.endsOn < v.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date is before the start date." });
    }
    // An offer that has already ended would be saved and then never apply — almost
    // certainly a mistyped year, so say so rather than store something inert.
    if (!v.noEnd && v.endsOn && v.endsOn < localDateStr(new Date())) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date is in the past." });
    }
  });

export function parseOfferForm(formData: FormData): { offer: ProcedureOffer } | { error: string } {
  const parsed = offerSchema.safeParse({
    type: formData.get("offerType"),
    value: formData.get("offerValue"),
    startsOn: formData.get("offerStartsOn") ?? "",
    endsOn: formData.get("offerEndsOn") ?? "",
    noEnd: formData.get("offerNoEnd") === "on",
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  return {
    offer: {
      type: parsed.data.type,
      value: parsed.data.value,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.noEnd ? null : parsed.data.endsOn,
    },
  };
}
