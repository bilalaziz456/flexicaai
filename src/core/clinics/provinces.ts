/**
 * Pakistan's administrative units — CORE, specialty-agnostic, client-safe (no DB, no
 * `server-only`), so the admin form's dropdown and the server's validation read one list.
 *
 * A CONSTANT rather than a table, deliberately. ADR-027's test for "should this be a
 * reference table" is whether a bad value produces a wrong FIGURE silently; a bad
 * province produces a wrong COUNT, which is visible and harmless by comparison. The
 * list also changes about once a decade, so a row you could edit without a deploy buys
 * nothing here.
 *
 * Seven entries: four provinces, the federal capital territory, and two autonomous
 * territories. AJK and Gilgit-Baltistan are NOT provinces constitutionally — they are
 * listed because a clinic in Muzaffarabad has to be filed somewhere, and "province" is
 * the field label a user understands.
 */
export const PROVINCES = [
  { code: "punjab", label: "Punjab" },
  { code: "sindh", label: "Sindh" },
  { code: "kpk", label: "Khyber Pakhtunkhwa" },
  { code: "balochistan", label: "Balochistan" },
  { code: "ict", label: "Islamabad Capital Territory" },
  { code: "ajk", label: "Azad Jammu & Kashmir" },
  { code: "gb", label: "Gilgit-Baltistan" },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]["code"];

const BY_CODE = new Map(PROVINCES.map((p) => [p.code as string, p]));

/** True for a code this application knows. Use at every boundary before storing. */
export function isProvinceCode(value: unknown): value is ProvinceCode {
  return typeof value === "string" && BY_CODE.has(value);
}

/**
 * Narrow an untrusted value (a URL filter, a form field) to a province, or null.
 *
 * Narrowed rather than cast: an unknown value drops its filter condition instead of
 * silently matching nothing, which is the same rule the money-path codes follow.
 */
export function asProvinceCode(value: unknown): ProvinceCode | null {
  return isProvinceCode(value) ? value : null;
}

/** Display name for a stored code; falls back to the code so nothing renders blank. */
export function provinceLabel(code: string | null | undefined): string {
  if (!code) return "";
  return BY_CODE.get(code)?.label ?? code;
}
