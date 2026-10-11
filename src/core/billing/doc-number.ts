/**
 * Reads a typed DOCUMENT number — an invoice or receipt number — out of a search term,
 * so a list can match it EXACTLY. PURE, shared by the top search, the invoice register
 * and the payments ledger, so a number means the same thing on every screen.
 *
 * WHY EXACT. Matching a typed number as a substring of the label also found every
 * longer number containing it — the owner searched one invoice and got a page of them
 * (2026-10-12).
 *
 * Numbers are one running series per clinic, "INV-100005" / "RCP-100005" (migration
 * 0121), so the prefix is dropped and the digits are the number: "INV-100005",
 * "100005" → 100005. Anything longer than 7 digits is an MRN or a phone, not a
 * document number, so it returns null. `year` stays in the shape for callers written
 * against the old yearly series, and is always null now.
 */
export type DocNumber = { year: number | null; no: number };

export function parseDocNumber(q: string, invoicePrefix?: string | null): DocNumber | null {
  // A term carrying LETTERS that are not the invoice prefix ("RCP-100009", an old
  // receipt) is not an invoice number — taking just its digits would open a different
  // patient's invoice that happens to share them.
  const letters = q.replace(/[^a-z]/gi, "").toUpperCase();
  const prefixLetters = (invoicePrefix ?? "INV").replace(/[^a-z]/gi, "").toUpperCase();
  if (letters && letters !== prefixLetters) return null;
  const digits = q.replace(/\D/g, "");
  if (digits && digits.length <= 7) return { year: null, no: Number(digits) };
  return null;
}
