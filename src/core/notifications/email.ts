import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/core/lib/env";
import { report, reportEvent } from "@/core/observability";

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
    // The recipient address is PII, so it is NOT logged — the subject identifies
    // which flow was affected, which is what an operator actually needs.
    reportEvent("email not configured — send skipped", {
      op: "notifications.email.send",
      severity: "warn",
      ids: { subject: args.subject },
    });
    return { ok: false, error: "Email is not configured." };
  }
  try {
    await t.sendMail({ from: from(), to: args.to, subject: args.subject, text: args.text, html: args.html });
    return { ok: true };
  } catch (e) {
    // Password-reset mail rides this path: a silent failure looks to the user like
    // the reset link was never issued, and they have no way to tell us why.
    report(e, { op: "notifications.email.send", ids: { subject: args.subject } });
    return { ok: false, error: "Email send failed." };
  }
}
