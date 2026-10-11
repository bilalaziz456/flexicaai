/**
 * Reads a typed DOCUMENT number — an invoice or receipt number — out of a search term,
 * so a list can match it EXACTLY. PURE, shared by the top search, the invoice register
 * and the payments ledger, so "0000002" means the same thing on every screen.
 *
 * WHY EXACT. The printed label is `<prefix><YYYY>-<7-digit>`, and matching a typed
 * "0000002" as a substring of it also found 0000020–0000029, 0000120… — the owner
 * searched one invoice and got a page of them (2026-10-12).
 *
 * "INV-2026-0000002" / "2026-2" → that year's number 2. A bare run of up to 7 digits
 * ("0000002", "2") → number 2 in any year. Anything longer is an MRN or a phone, not a
 * document number, so it returns null.
 */
export type DocNumber = { year: number | null; no: number };

export function parseDocNumber(q: string): DocNumber | null {
  const paired = /(\d{4})\s*-\s*(\d{1,7})(?!\d)/.exec(q);
  if (paired) return { year: Number(paired[1]), no: Number(paired[2]) };
  const digits = q.replace(/\D/g, "");
  if (digits && digits.length <= 7) return { year: null, no: Number(digits) };
  return null;
}
