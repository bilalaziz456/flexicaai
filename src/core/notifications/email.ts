import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/core/lib/env";

/**
 * Email channel — CORE, specialty-agnostic, provider-agnostic (any SMTP host via
 * nodemailer: SES / Resend / Postmark / …). Config-gated exactly like the WhatsApp
 * channel: without SMTP host+user+pass it NO-OPS (logs) so the app boots and tests run
 * the same — the live send is a §Z go-live step. Best-effort: never throws.
 */

/** True when SMTP is configured (host + user + pass present). */
export function isEmailConfigured(): boolean {
  return Boolean(serverEnv.SMTP_HOST && serverEnv.SMTP_USER && serverEnv.SMTP_PASS);
}

// One transport, lazily built and reused.
let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: serverEnv.SMTP_HOST!,
      port: serverEnv.SMTP_PORT,
      secure: serverEnv.SMTP_SECURE, // true for 465, false for 587/STARTTLS
      auth: { user: serverEnv.SMTP_USER!, pass: serverEnv.SMTP_PASS! },
    });
  }
  return transport;
}

const from = (): string => serverEnv.EMAIL_FROM || serverEnv.SMTP_USER || "no-reply@flexicaai.com";

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport();
  if (!t) {
    // Graceful no-send: the flow still works (token issued etc.), only delivery waits.
    console.warn(`[email] not configured. Skipped "${args.subject}" → ${args.to}`);
    return { ok: false, error: "Email is not configured." };
  }
  try {
    await t.sendMail({ from: from(), to: args.to, subject: args.subject, text: args.text, html: args.html });
    return { ok: true };
  } catch (e) {
    console.error("[email] send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Email send failed." };
  }
}
