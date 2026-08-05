import "server-only";

import { serverEnv } from "@/core/lib/env";
import { sendViaCloud, isCloudConfigured } from "./cloud";

/**
 * WhatsApp integration — CORE, specialty-agnostic (CLAUDE.md §2). The whole app
 * sends through `sendWhatsAppTemplate`, so which PROVIDER actually delivers is an
 * implementation detail here:
 *
 *   - "aisensy" (default): one platform account/number (a `campaignName` maps to
 *     an approved template). This file.
 *   - "cloud": Meta WhatsApp Cloud API — one WABA token, and the message is sent
 *     FROM a per-clinic `phoneNumberId` (so patients see the clinic's own number).
 *     See ./cloud.ts and docs/whatsapp-cloud-plan.md.
 *
 * `WHATSAPP_PROVIDER` selects between them; the callers (notifications, recall,
 * booking, reschedule) never change. Sends are gated on config — without it the
 * caller gets a clear error and the message is still logged (queued) upstream, so
 * nothing is silently dropped.
 */

export class WhatsAppNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? "WhatsApp sending is disabled (provider not configured).");
  }
}

/** True if the ACTIVE provider is configured to send at all (platform-level). */
export function isWhatsAppConfigured(): boolean {
  return serverEnv.WHATSAPP_PROVIDER === "cloud"
    ? isCloudConfigured()
    : Boolean(serverEnv.AISENSY_API_KEY);
}

/** Normalise a phone number to digits only (country code, no +). */
export function normalisePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/**
 * Placeholder for an otherwise-empty template variable. WhatsApp (Meta) REJECTS a send
 * whose body variable is blank / whitespace-only / contains a newline or tab — so no
 * template needs a "with vs without" split; a missing value becomes "—".
 */
const EMPTY_PARAM = "—";

/** Make one template variable Meta-safe: collapse whitespace/newlines, trim, and never
 *  return an empty string. */
function cleanParam(value: string | null | undefined): string {
  const t = (value ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : EMPTY_PARAM;
}

export type SendTemplateArgs = {
  /** Destination phone, digits with country code (e.g. 923001234567). */
  to: string;
  /** Approved template name — AiSensy campaign name OR Cloud API template name. */
  campaignName: string;
  /** Recipient display name AiSensy stores against the contact (Cloud ignores). */
  userName?: string;
  /** Ordered template body params ({{1}}, {{2}}, …). */
  templateParams?: string[];
  /** Header document/image, if the template has a media header. */
  media?: { url: string; filename: string };
  /**
   * CLOUD ONLY — the WABA phone-number id to send FROM (the clinic's own number).
   * Resolved per clinic by the notification layer (Phase 3). AiSensy ignores it
   * (single account); Cloud requires it.
   */
  phoneNumberId?: string | null;
  /** CLOUD ONLY — the template's language code (default "en"). */
  languageCode?: string;
  /**
   * CLOUD ONLY — the clinic's signature appended to the template's trailing
   * `{{signature}}` variable (docs/whatsapp-cloud-plan.md). AiSensy ignores it.
   */
  signature?: string | null;
};

export type SendResult =
  | { ok: true; externalId?: string }
  | { ok: false; error: string };

/** Send a WhatsApp template via the active provider. Throws if unconfigured. */
export async function sendWhatsAppTemplate(
  args: SendTemplateArgs,
): Promise<SendResult> {
  // Sanitize every variable so Meta never rejects the send on a blank/whitespace param.
  // The signature (Cloud, trailing var) is dropped when blank so the param count stays
  // consistent with a template that has no signature var; a real one is cleaned.
  const sig = args.signature?.trim();
  const clean: SendTemplateArgs = {
    ...args,
    templateParams: args.templateParams?.map(cleanParam),
    signature: sig ? cleanParam(sig) : null,
  };
  if (serverEnv.WHATSAPP_PROVIDER === "cloud") {
    return sendViaCloud(clean);
  }
  return sendViaAisensy(clean);
}

/** AiSensy v2 Campaign API sender (the default, single-account provider). */
async function sendViaAisensy(args: SendTemplateArgs): Promise<SendResult> {
  if (!serverEnv.AISENSY_API_KEY) {
    throw new WhatsAppNotConfiguredError(
      "AISENSY_API_KEY is not set. WhatsApp sending is disabled.",
    );
  }

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
