/**
 * A clinic's MRN SERIES (owner's call, 2026-10-13). The super admin / account manager
 * types a STARTING MRN — "FA-100001", "GS-00000001", "MRN2024-001" — and it is split
 * into the part that stays the same (the prefix) and the trailing digits, which are the
 * counter: their LENGTH is the padding every later number keeps ("GS-00000002"), and
 * their value is where counting starts. Outgrowing the width just adds a digit
 * ("AB-999" → "AB-1000").
 *
 * PURE (no DB), so the admin form checks exactly what the server checks.
 */

export const MRN_MIN_LENGTH = 3;
export const MRN_MAX_LENGTH = 15;
/** At least this many digits at the end — "AB-1" is not a series. */
export const MRN_MIN_DIGITS = 3;
/** Used when the starting MRN is left empty. */
export const DEFAULT_STARTING_MRN = "FA-100001";

export type MrnSeries = { prefix: string; width: number; start: number };

/** "GS-00000001" → { prefix: "GS-", width: 8, start: 1 }, or an error for the form. */
export function parseStartingMrn(raw: string): MrnSeries | { error: string } {
  const v = raw.trim().toUpperCase();
  if (v.length < MRN_MIN_LENGTH || v.length > MRN_MAX_LENGTH) {
    return { error: `The MRN must be ${MRN_MIN_LENGTH}–${MRN_MAX_LENGTH} characters, e.g. ${DEFAULT_STARTING_MRN}.` };
  }
  if (!/^[A-Z0-9-]+$/.test(v)) {
    return { error: "Use only letters, numbers and - in the MRN." };
  }
  if (v.startsWith("-")) return { error: "The MRN can't start with -." };
  // The counter is the LAST run of digits; anything before it is the fixed prefix.
  const m = /^(.*?)(\d+)$/.exec(v);
  if (!m || m[2].length < MRN_MIN_DIGITS) {
    return { error: `The MRN must end with at least ${MRN_MIN_DIGITS} digits, e.g. ${DEFAULT_STARTING_MRN}.` };
  }
  const start = Number(m[2]);
  if (!Number.isSafeInteger(start)) return { error: "That number is too large." };
  return { prefix: m[1], width: m[2].length, start };
}

/** The printed MRN for number `n` in a series: prefix + n, zero-padded to the width. */
export function formatMrnLabel(prefix: string, width: number, n: number): string {
  return `${prefix}${String(n).padStart(width, "0")}`;
}

/** The MRN the clinic's next patient will get ("FA-100231"). */
export function nextMrnLabel(c: { mrnPrefix: string; mrnWidth: number; nextMrn: number }): string {
  return formatMrnLabel(c.mrnPrefix, c.mrnWidth, Number(c.nextMrn));
}

/**
 * The digits in a search term, so "MRN-42", "42" and "#42" all resolve to "42".
 * Empty when the term has no digits.
 */
export function mrnDigits(q: string): string {
  return q.replace(/\D/g, "");
}
