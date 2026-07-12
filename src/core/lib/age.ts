/**
 * Age ⇄ birth-date helpers — CORE, pure and isomorphic (client + server).
 *
 * Patients are entered by AGE (convenient at the desk), but we store a birth
 * DATE so the age never goes stale — it's recomputed from the stored date each
 * time it's shown. The stored date is approximated as "today minus N years",
 * so the age round-trips exactly on the day of entry and advances naturally.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Whole years from a `YYYY-MM-DD` birth date to `now`. Null if unparseable. */
export function ageFromDob(
  dob: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let age = now.getFullYear() - y;
  const month = now.getMonth() + 1;
  const hadBirthday = month > mo || (month === mo && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age >= 0 && age < 200 ? age : null;
}

/** A `YYYY-MM-DD` birth date approximated from a whole-year age (today − age). */
export function dobFromAge(age: number, now: Date = new Date()): string {
  const y = now.getFullYear() - age;
  return `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Parses a raw age form value into a stored birth date. Empty/invalid → null;
 * a valid whole age (0–150) → the approximated `YYYY-MM-DD`.
 */
export function dobFromAgeField(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 150) return null;
  return dobFromAge(n);
}
