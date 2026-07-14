import "server-only";

import { serverEnv } from "@/core/lib/env";
import type { SendTemplateArgs, SendResult } from "./index";

/**
 * Meta WhatsApp Cloud API sender — CORE. One WABA system-user token controls many
 * numbers; the message is sent FROM the clinic's own number, selected by
 * `phoneNumberId`, so patients see the clinic's number. Templates are approved once
 * at the WABA level and shared across every clinic number. See
 * docs/whatsapp-cloud-plan.md.
 *
 * Same `SendResult` contract as the AiSensy path, so the dispatcher and all callers
 * are provider-agnostic.
 */

/** True if the Cloud API is configured at the platform level (token present). */
export function isCloudConfigured(): boolean {
  return Boolean(serverEnv.WHATSAPP_CLOUD_TOKEN);
}

const digitsOnly = (phone: string): string => phone.replace(/[^0-9]/g, "");

type TemplateComponent =
  | { type: "header"; parameters: { type: "document"; document: { link: string; filename: string } }[] }
  | { type: "body"; parameters: { type: "text"; text: string }[] };

export async function sendViaCloud(args: SendTemplateArgs): Promise<SendResult> {
  const token = serverEnv.WHATSAPP_CLOUD_TOKEN;
  if (!token) {
    return { ok: false, error: "WhatsApp Cloud API is not configured (no token)." };
  }
  // The sending number is per-clinic; without it we can't send from the Cloud API.
  if (!args.phoneNumberId) {
    return { ok: false, error: "This clinic has no WhatsApp sender number configured." };
  }

  const components: TemplateComponent[] = [];
  if (args.media) {
    components.push({
      type: "header",
      parameters: [
        { type: "document", document: { link: args.media.url, filename: args.media.filename } },
      ],
    });
  }
  if (args.templateParams && args.templateParams.length > 0) {
    components.push({
      type: "body",
      parameters: args.templateParams.map((t) => ({ type: "text" as const, text: t })),
    });
  }

  const body = {
    messaging_product: "whatsapp",
    to: digitsOnly(args.to),
    type: "template",
    template: {
      name: args.campaignName,
      language: { code: args.languageCode ?? "en" },
      ...(components.length ? { components } : {}),
    },
  };

  const url = `https://graph.facebook.com/${serverEnv.WHATSAPP_API_VERSION}/${args.phoneNumberId}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: `WhatsApp Cloud ${res.status}: ${text.slice(0, 300)}` };
  }
  // Success shape: { messages: [{ id: "wamid...." }] }
  let externalId: string | undefined;
  try {
    const json = JSON.parse(text) as { messages?: { id?: string }[] };
    externalId = json.messages?.[0]?.id;
  } catch {
    // Non-JSON success — fine, we just have no id.
  }
  return { ok: true, externalId };
}
