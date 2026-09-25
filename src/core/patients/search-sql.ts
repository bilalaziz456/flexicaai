import "server-only";

import { ilike, or, sql, type SQL } from "drizzle-orm";
import { patients } from "@/core/db/schema";

/**
 * "Which patient is this?" as ONE predicate, for every list that lets the front desk
 * find a patient by whatever they happen to be holding.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN PER LIST. The payments ledger and the invoice
 * register had each grown their own copy, and they had already drifted: invoices
 * matched `external_ref` (the clinic's imported patient number) and payments did not,
 * so the same search found a patient on one screen and not the other. Receivables was
 * a third copy matching only name and phone. There is one question here — is this the
 * patient? — so there is one answer (ADR-015's rule, applied to a search predicate
 * rather than to money).
 *
 * WHAT A CALLER STILL OWNS is its own DOCUMENT number: an invoice number belongs to
 * the invoice register and a receipt number to the payments ledger. Those are ORed
 * onto this, never folded into it.
 *
 * THE MRN IS MATCHED IN ITS PRINTABLE FORM, which is why the prefix is a parameter.
 * `patients.mrn` is a bare integer; what the desk reads off a card is
 * `<prefix><YYYYMMDD registration><7-digit>` (`core/patients/mrn.ts#formatMrn`). So the
 * SQL rebuilds that string and matches against it — a full "KL-202609070000001", a
 * partial digit run, or the prefix alone all hit.
 *
 * AND IT IS BUILT IN SERVER-LOCAL TIME, deliberately. `formatMrn` renders the date in
 * the server's zone; `to_char` on a `timestamptz` would use the SESSION's zone, and a
 * patient registered near midnight would render one day in the UI and another in the
 * search — a full-MRN search that misses the patient it names. This is the D-14
 * single-timezone assumption showing through, and it stays correct exactly as long as
 * that assumption does.
 */
export function patientSearchSql(q: string | undefined, mrnPrefix: string): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term}%`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return or(
    ilike(patients.fullName, like),
    ilike(patients.phone, like),
    // The clinic's OWN patient number from whatever system it came off — the desk
    // often still quotes this, and it is the one identifier a patient may have
    // written down from before FlexicaAI existed.
    ilike(patients.externalRef, like),
    sql`(${mrnPrefix} || to_char(${patients.createdAt} AT TIME ZONE ${tz}, 'YYYYMMDD') || lpad(${patients.mrn}::text, 7, '0')) ilike ${like}`,
  );
}
