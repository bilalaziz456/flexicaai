import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";

/**
 * Clinic-owned settings a clinic admin changes about THEIR OWN clinic — CORE per
 * ADR-014. Distinct from `core/admin/*`, which is the company changing settings about
 * a clinic: same table, different authority, and keeping them apart is what stops a
 * clinic-side action growing a field only the super admin should set.
 *
 * Takes `clinicId` first and filters on it, so a caller cannot write to another
 * tenant's row even by mistake.
 */
export async function setInvoicePaper(clinicId: string, paper: string): Promise<void> {
  await db
    .update(clinics)
    .set({ invoicePaper: paper, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
}

/** The clinic's WhatsApp message footer. */
export async function setWhatsappSignature(
  clinicId: string,
  signature: string | null,
): Promise<void> {
  await db
    .update(clinics)
    .set({ whatsappSignature: signature, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
}

/** The clinic's average visit value — the multiplier behind "Revenue Recovered". */
export async function setAvgVisitValue(clinicId: string, value: number): Promise<void> {
  await db
    .update(clinics)
    .set({ avgVisitValue: value, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
}

/** Whether CLINIC-borne discounts need sign-off before they apply. */
export async function setDiscountNeedsApproval(
  clinicId: string,
  requireApproval: boolean,
): Promise<void> {
  await db
    .update(clinics)
    .set({ discountNeedsApproval: requireApproval, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
}
