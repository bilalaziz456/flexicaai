import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { procedures } from "@/core/db/schema";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";

export type QuotableProcedure = { id: string; name: string; price: number };

/**
 * The procedures a clinic is willing to quote over WhatsApp — CORE, clinic-scoped.
 *
 * ACTIVE ONLY. An inactive procedure is one the clinic has stopped offering but kept
 * for history; quoting a price for something they no longer do is worse than saying
 * nothing.
 *
 * GATED ON `sales`, not on the WhatsApp features. Priced procedures only exist at all
 * when that feature is on, so without it there is no list to quote from — and the
 * classifier is then told the price intent is unavailable, which turns a price
 * question into `other` and sends it to a person.
 *
 * The list is handed to the model as a CLOSED SET: it may only return an id from
 * here, and the price is read from the row afterwards, so no figure ever passes
 * through the model.
 */
export async function listQuotableProcedures(clinicId: string): Promise<QuotableProcedure[]> {
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) return [];

  return db
    .select({ id: procedures.id, name: procedures.name, price: procedures.price })
    .from(procedures)
    .where(
      byClinic(
        procedures.clinicId,
        clinicId,
        notDeleted(procedures.deletedAt),
        eq(procedures.isActive, true),
      ),
    )
    .orderBy(asc(procedures.name));
}
