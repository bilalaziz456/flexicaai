"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DiscountDefaultBearer, ShareRatesByDoctor } from "@/core/clinics/discount-default";

/**
 * The clinic's default discount bearer, given once by the clinic layout so every
 * discount box in the workspace — booking, invoice, consultation, each line, a
 * treatment plan — opens on it without each page passing it down.
 *
 * `shareRates` is every doctor's share, for a split's doctor part (a doctor bears the
 * same % of a discount as they earn). Null where it was not loaded — the default is not
 * a split, or this person books nothing — and then a split's part is left for staff to
 * type, as before.
 */
export type DiscountDefaultValue = {
  borneBy: DiscountDefaultBearer;
  shareRates: ShareRatesByDoctor | null;
};

const DiscountDefaultContext = createContext<DiscountDefaultValue>({ borneBy: "clinic", shareRates: null });

export function DiscountDefaultProvider({ value, children }: { value: DiscountDefaultValue; children: ReactNode }) {
  return <DiscountDefaultContext.Provider value={value}>{children}</DiscountDefaultContext.Provider>;
}

export function useDiscountDefault(): DiscountDefaultValue {
  return useContext(DiscountDefaultContext);
}
