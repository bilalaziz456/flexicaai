import "server-only";

import { eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { patients } from "@/core/db/schema";
import { phoneSearchTerm } from "@/core/lib/phone";

/**
 * Does this patient's phone match the term? The raw substring, OR — when the term is
 * phone-shaped — its digits placed where they belong in an E.164 number, so "0345" and
 * "03450186120" both find a patient stored as "+923450186120" (`phoneSearchTerm` says
 * how). Every patient search uses this; a screen with its own `ilike(phone)` finds a
 * number the others miss. The raw match stays for numbers stored before E.164.
 */
export function patientPhoneMatchSql(term: string): SQL {
  const t = term.trim();
  const raw = ilike(patients.phone, `%${t}%`);
  const p = phoneSearchTerm(t);
  if (!p) return raw;
  // `digits` is digits only (phoneSearchTerm strips everything else), so it is safe
  // to place in a pattern; it still travels as a bound parameter.
  const shaped =
    p.anchor === "national"
      ? sql`${patients.phone} ~ ${String.raw`^\+[0-9]{1,3}` + p.digits}`
      : p.anchor === "international"
        ? ilike(patients.phone, `+${p.digits}%`)
        : ilike(patients.phone, `%${p.digits}%`);
  return or(raw, shaped)!;
}

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
 * THE MRN is matched two ways: a bare number ("23", "0000023") is the MRN's NUMBER,
 * exactly, in any series; anything else is matched against the printed MRN STORED on
 * the patient ("FA-1000", a pasted "GS-00000042"). The MRN used to be re-assembled
 * here from the clinic's prefix and the registration date, which is why `mrnPrefix`
 * is still a parameter — it is no longer read (`core/patients/mrn.ts`).
 */
export function patientSearchSql(
  q: string | undefined,
  mrnPrefix: string,
  /** False on a DOCUMENT screen when the term is a document number: there "0000023"
   *  means invoice / payment 23, not also every invoice of the patient with MRN 23
   *  (owner's report, 2026-10-12). The MRN in its full printed form is not a bare
   *  number, so it still finds the patient. */
  opts: { mrn?: boolean } = {},
): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term}%`;

  return or(
    ilike(patients.fullName, like),
    patientPhoneMatchSql(term),
    // The clinic's OWN patient number from whatever system it came off — the desk
    // often still quotes this, and it is the one identifier a patient may have
    // written down from before FlexicaAI existed.
    ilike(patients.externalRef, like),
    // A bare short number ("0000002", "2") is the MRN's NUMBER, matched exactly: as a
    // substring of the 7-digit tail it also found MRN 20–29, 120… — a page of patients
    // for one number. Longer runs (a date, a full MRN) and prefixed forms stay partial.
    opts.mrn === false
      ? undefined
      : /^\d{1,15}$/.test(term)
      ? eq(patients.mrn, Number(term))
      : ilike(patients.mrnLabel, like),
  );
}
