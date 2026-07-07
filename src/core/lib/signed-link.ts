import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/core/lib/env";

/**
 * HMAC-signed public links — CORE. Lets us hand out an unguessable, expiring URL
 * to a resource (e.g. a prescription PDF sent over WhatsApp) that WhatsApp/the
 * patient can open WITHOUT a session. The token carries only an id + expiry and
 * a signature; tampering or expiry makes it invalid. Disabled when
 * LINK_SIGNING_SECRET is unset (returns null), so links are never unsigned.
 */

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function isPublicLinkingEnabled(): boolean {
  return Boolean(serverEnv.LINK_SIGNING_SECRET);
}

/** Sign `id` with an expiry (ms epoch). Returns null if signing is disabled. */
export function signToken(id: string, expiresAtMs: number): string | null {
  const secret = serverEnv.LINK_SIGNING_SECRET;
  if (!secret) return null;
  const payload = `${id}.${expiresAtMs}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64url(Buffer.from(payload))}.${b64url(sig)}`;
}

/** Verify a token; returns the id if valid and unexpired, else null. */
export function verifyToken(token: string): string | null {
  const secret = serverEnv.LINK_SIGNING_SECRET;
  if (!secret || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payload: string;
  let sig: Buffer;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return null;
  }

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const id = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return id;
}
