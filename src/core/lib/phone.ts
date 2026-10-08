/**
 * Phone numbers — one canonical form, PURE (no DB, no server-only) so the patient
 * form, the save path and the WhatsApp matcher all agree.
 *
 * They did not agree before. Two normalisers existed with almost the same name:
 * `normalisePhone` in the WhatsApp integration only stripped non-digits, so
 * "03450186120" stayed "03450186120" and never matched an inbound "923450186120" —
 * a patient saved in local format was invisible to inbound WhatsApp. The fuller
 * `normalizePhone` lived in the CSV importer and was never used anywhere else.
 *
 * Everything is stored as E.164 ("+923450186120"), so these all converge:
 *
 *   03450186120        local, leading 0
 *   923450186120       country code, no plus
 *   00923450186120     international prefix
 *   +923450186120      E.164
 *   +92 345-018 6120   spaces and dashes
 */

/** Pakistan. The GCC clinics need their own — see `toE164`. */
export const DEFAULT_COUNTRY_CODE = "92";

/**
 * Best-effort E.164 for storage. `defaultCc` is the country code assumed for a
 * LOCAL number (one starting `0`, or bare digits) — pass the clinic's, because a
 * UAE clinic's "0501234567" is +971, not +92. Returns null for empty input.
 *
 * `valid` is false when the result is not a plausible E.164 number; the caller
 * decides whether to reject or keep and flag it.
 */
export function toE164(
  raw: string,
  defaultCc: string = DEFAULT_COUNTRY_CODE,
): { phone: string | null; valid: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { phone: null, valid: true };
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { phone: null, valid: true };

  let e164: string;
  if (hasPlus) e164 = "+" + digits;
  else if (digits.startsWith("00")) e164 = "+" + digits.slice(2);
  else if (digits.startsWith("0")) e164 = "+" + defaultCc + digits.slice(1);
  // Already carries the country code, and is long enough to be a real number.
  else if (digits.startsWith(defaultCc) && digits.length >= defaultCc.length + 9) {
    e164 = "+" + digits;
  } else e164 = "+" + defaultCc + digits;

  return { phone: e164, valid: /^\+\d{10,15}$/.test(e164) };
}

/**
 * The digits used for matching — E.164 without the plus. Inbound webhooks give the
 * number in this shape, so comparing on it is what makes a stored number findable.
 */
export function phoneDigits(raw: string, defaultCc: string = DEFAULT_COUNTRY_CODE): string {
  return toE164(raw, defaultCc).phone?.slice(1) ?? "";
}

/**
 * The digits to SEARCH stored phones by, or null when the term is not phone-shaped.
 *
 * Stored numbers are E.164, but the desk types what is on the patient's card —
 * "0345 0186120" — and a plain substring match of that against "+923450186120"
 * finds nothing. Dropping the trunk "0" (or the "00" international prefix) leaves the
 * national number, which IS a substring of the E.164 form whatever the country code,
 * so this needs no clinic country and works for a partial number too.
 */
export function phoneSearchDigits(term: string): string | null {
  const t = term.trim();
  if (!/^\+?[\d\s\-().]+$/.test(t)) return null;
  let digits = t.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  // Below this the raw substring match already does the job, and a 1–3 digit run
  // would match most of the list.
  return digits.length >= 4 ? digits : null;
}

/**
 * Keep a field to what can legally be typed into a phone number: digits, and a `+`
 * only in first position.
 *
 * Sanitising as you type rather than rejecting on submit. Someone pasting
 * "+92 345-018 6120" from a chat has given us a perfectly good number, and refusing
 * it teaches them the form is fussy without making the data any cleaner — this
 * removes the spaces and dashes instead, so nothing messy can be stored either way.
 */
export function sanitisePhoneInput(raw: string): string {
  const plus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return (plus ? "+" : "") + digits;
}
