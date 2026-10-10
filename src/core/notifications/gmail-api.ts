import "server-only";

import nodemailer from "nodemailer";
import { serverEnv } from "@/core/lib/env";

/**
 * Sending through the Gmail API over HTTPS — the alternative to SMTP for a host that
 * blocks the mail ports (ours blocks 587 and 465 outbound). Port 443 cannot be
 * blocked without blocking the web, so this works wherever the app can reach Google.
 *
 * NO NEW DEPENDENCY. nodemailer still BUILDS the message (its stream transport
 * renders the exact MIME it would have sent over SMTP — headers, encoding, the
 * html/text alternative, Reply-To); this module only refreshes an OAuth access token
 * and POSTs that message to Gmail. Two plain `fetch` calls instead of `googleapis`.
 *
 * Authorised by a REFRESH TOKEN for the `gmail.send` scope, obtained once on a PC with
 * `npm run email:gmail-token` and pasted into the server's env. Two ways it stops
 * working, both of which surface as an `invalid_grant` on refresh:
 *   - the OAuth consent screen was left in "Testing", where Google expires refresh
 *     tokens after 7 days — publish it ("In production") before relying on this;
 *   - the account's password changed, or access was revoked.
 * Either way the fix is to run the script again and replace GMAIL_REFRESH_TOKEN.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
/** Both calls are on the request path of a password reset or a contact enquiry. */
const TIMEOUT_MS = 15_000;

export function isGmailApiConfigured(): boolean {
  return Boolean(
    serverEnv.GMAIL_CLIENT_ID && serverEnv.GMAIL_CLIENT_SECRET && serverEnv.GMAIL_REFRESH_TOKEN,
  );
}

// An access token lives an hour; refreshing per email would double every send's
// latency for nothing. Refreshed a minute early so a send never races the expiry.
let cached: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: serverEnv.GMAIL_CLIENT_ID!,
      client_secret: serverEnv.GMAIL_CLIENT_SECRET!,
      refresh_token: serverEnv.GMAIL_REFRESH_TOKEN!,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    // `invalid_grant` is the one an operator must act on, so it says what to do.
    throw new Error(
      body.error === "invalid_grant"
        ? "Gmail API refresh token rejected (invalid_grant) — run `npm run email:gmail-token` again and replace GMAIL_REFRESH_TOKEN."
        : `Gmail API token refresh failed: HTTP ${res.status} ${body.error ?? ""}`.trim(),
    );
  }
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.token;
}

// Renders the message to a buffer instead of sending it anywhere.
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });

/** Throws on failure; `sendEmail` owns the best-effort boundary and the report. */
export async function sendViaGmailApi(message: {
  /** Omitted = Gmail uses the authorised account. A different address only works if
   *  it is a verified "Send mail as" alias of that account; otherwise Gmail rewrites it. */
  from?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const info = await composer.sendMail(message);
  const mime = info.message;
  if (!Buffer.isBuffer(mime)) throw new Error("Gmail API: message did not render to a buffer.");
  const raw = mime.toString("base64url");

  const post = async (token: string) =>
    fetch(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await post(await getAccessToken());
  // A cached token Google has already retired: drop it and try once with a fresh one.
  if (res.status === 401) {
    cached = null;
    res = await post(await getAccessToken());
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { status?: string; message?: string };
    } | null;
    throw new Error(
      `Gmail API send failed: HTTP ${res.status} ${body?.error?.status ?? ""} ${body?.error?.message ?? ""}`.trim(),
    );
  }
}
