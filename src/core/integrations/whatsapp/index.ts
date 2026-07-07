import "server-only";

import { serverEnv } from "@/core/lib/env";

/**
 * WhatsApp integration — CORE, specialty-agnostic (CLAUDE.md §2). Wraps AiSensy
 * (our WhatsApp Business API provider). Business-initiated messages go out as
 * approved TEMPLATE campaigns; AiSensy's v2 Campaign API takes the campaign name
 * (which maps to a template) plus the destination and any params/media.
 *
 * The whole app sends through here, so swapping providers later touches only
 * this file. Sends are gated on config: without AISENSY_API_KEY the caller gets
 * a clear error and the message is still logged upstream (queued), so nothing is
 * silently dropped.
 */

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super("AISENSY_API_KEY is not set — WhatsApp sending is disabled.");
  }
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(serverEnv.AISENSY_API_KEY);
}

/** Normalise a phone number to digits only (AiSensy wants country code, no +). */
export function normalisePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export type SendTemplateArgs = {
  /** Destination phone, digits with country code (e.g. 923001234567). */
  to: string;
  /** AiSensy campaign name (maps to an approved template). */
  campaignName: string;
  /** Recipient display name AiSensy stores against the contact. */
  userName?: string;
  /** Ordered template body params ({{1}}, {{2}}, …). */
  templateParams?: string[];
  /** Header document/image, if the template has a media header. */
  media?: { url: string; filename: string };
};

export type SendResult =
  | { ok: true; externalId?: string }
  | { ok: false; error: string };

/** Send a WhatsApp template campaign via AiSensy. Throws if unconfigured. */
export async function sendWhatsAppTemplate(
  args: SendTemplateArgs,
): Promise<SendResult> {
  if (!serverEnv.AISENSY_API_KEY) throw new WhatsAppNotConfiguredError();

  const body: Record<string, unknown> = {
    apiKey: serverEnv.AISENSY_API_KEY,
    campaignName: args.campaignName,
    destination: normalisePhone(args.to),
    userName: args.userName ?? "",
    templateParams: args.templateParams ?? [],
  };
  if (args.media) {
    body.media = { url: args.media.url, filename: args.media.filename };
  }

  let res: Response;
  try {
    res = await fetch(serverEnv.AISENSY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: `AiSensy ${res.status}: ${text.slice(0, 300)}` };
  }
  let externalId: string | undefined;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    externalId =
      (json.messageId as string) ??
      (json.id as string) ??
      (json.submitted_message_id as string) ??
      undefined;
  } catch {
    // Non-JSON success body — fine, we just have no id.
  }
  return { ok: true, externalId };
}
