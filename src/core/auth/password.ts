import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing. bcrypt is intentionally slow to resist brute force; the
 * cost factor sets how slow. 12 is a good 2020s default (a handful of ms).
 * bcryptjs is pure JS — no native build step, which matters on Windows.
 */
const BCRYPT_COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
