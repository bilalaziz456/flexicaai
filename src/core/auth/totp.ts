import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) + one-time backup codes — CORE, dependency-free (Node crypto only).
 * Standard authenticator-app compatible: base32 secret, HMAC-SHA1, 30s period, 6 digits.
 * Used for super-admin panel 2FA (docs/super-admin-plan.md §11 Feature 1). Secrets are
 * stored as their base32 string; backup codes are stored ONLY as SHA-256 hashes.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue; // skip padding / spaces
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HMAC-based one-time password for a counter (the TOTP building block). */
function hotp(key: Buffer, counter: number): string {
  const cb = Buffer.alloc(8);
  cb.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(cb).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** A fresh 160-bit base32 secret to enrol. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The `otpauth://` URI an authenticator app scans (or you paste the secret manually). */
export function otpauthUrl(args: { secret: string; label: string; issuer: string }): string {
  const l = encodeURIComponent(`${args.issuer}:${args.label}`);
  const p = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${l}?${p.toString()}`;
}

/** Verify a 6-digit code against the secret, allowing ±`window` 30s steps for clock skew. */
export function verifyTotp(secret: string, code: string, window = 1, now = Date.now()): boolean {
  const clean = (code ?? "").replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;
  const key = base32Decode(secret);
  const step = Math.floor(now / 1000 / PERIOD);
  const target = Buffer.from(clean);
  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotp(key, step + w));
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) return true;
  }
  return false;
}

// ---- Backup codes ---------------------------------------------------------

function normalizeBackup(code: string): string {
  return (code ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}
function hashBackup(code: string): string {
  return createHash("sha256").update(normalizeBackup(code)).digest("hex");
}

/** N one-time backup codes: `codes` shown to the user ONCE; `hashes` stored. */
export function generateBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`; // e.g. a1b2c-3d4e5
    codes.push(code);
    hashes.push(hashBackup(code));
  }
  return { codes, hashes };
}

/** If `code` matches an unused backup hash, return the REMAINING hashes (one consumed);
 *  else null. Single-use by construction. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  if (normalizeBackup(code).length === 0) return null;
  const target = hashBackup(code);
  const idx = hashes.indexOf(target);
  if (idx < 0) return null;
  return hashes.filter((_, i) => i !== idx);
}
