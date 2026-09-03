import { NextResponse } from "next/server";
import { normalisePhone } from "@/core/integrations/whatsapp";
import {
  applyDeliveryReceipt,
  matchPatientAcrossPlatform,
  recordInboundMessage,
} from "@/core/integrations/whatsapp/inbound";
import { serverEnv } from "@/core/lib/env";
import { report, withRequestContext } from "@/core/observability";

/**
 * POST /api/whatsapp/webhook — inbound WhatsApp from AiSensy (incoming patient
 * messages + delivery/read receipts). Secured by a shared token in the query
 * (?token=), configured on both sides. Everything is stored (raw payload kept)
 * so the receptionist queue (Step 11) has the full history. Provider payload
 * shapes vary, so extraction is defensive.
 *
 * This route is an ADAPTER: it authenticates, digs the fields out of AiSensy's
 * payload, and resolves WHO sent the message. Everything after that — the idempotent
 * insert, self-service reschedule/booking, the in-app notification — is the shared
 * pipeline in `core/integrations/whatsapp/inbound.ts`, which the Cloud webhook feeds
 * too (delta D-10). Only the resolution differs between the two, and it differs for a
 * reason: this account has ONE number for every clinic, so the sender is all there is
 * to go on and the lookup is cross-tenant.
 */
function pick(obj: unknown, keys: string[]): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export async function POST(request: Request) {
  // Same reasoning as the Cloud webhook: nobody is watching this run, so give it a
  // correlation id and report a crash instead of letting the provider see a bare 500.
  return withRequestContext("webhook.whatsapp.aisensy", request, async () => {
    try {
      return await handleAisensyWebhook(request);
    } catch (e) {
      report(e, { op: "webhook.whatsapp.aisensy" });
      return NextResponse.json({ ok: false }, { status: 200 });
    }
  });
}

async function handleAisensyWebhook(request: Request) {
  const url = new URL(request.url);
  // Prefer a header (keeps the secret out of the URL / access logs); fall back to the
  // query param for providers that can only append it to the webhook URL.
  const token =
    request.headers.get("x-webhook-token") || url.searchParams.get("token");
  if (
    !serverEnv.WHATSAPP_WEBHOOK_TOKEN ||
    token !== serverEnv.WHATSAPP_WEBHOOK_TOKEN
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Provider payload shapes vary between AiSensy's own versions, so extraction is
  // deliberately defensive — try several key names at both nesting levels.
  const data = (payload.data ?? payload.message ?? payload) as unknown;
  const externalId =
    pick(payload, ["messageId", "id"]) ?? pick(data, ["messageId", "id"]);

  // ---- Delivery/read receipt: advance an existing outbound message ----
  const statusRaw = pick(payload, ["status"]) ?? pick(data, ["status"]);
  if (await applyDeliveryReceipt(externalId, statusRaw)) {
    return NextResponse.json({ ok: true, kind: "status" });
  }

  // ---- Incoming message ----
  const rawPhone =
    pick(payload, ["mobile", "waId", "from", "sender", "phone"]) ??
    pick(data, ["mobile", "waId", "from", "sender", "phone"]);
  const text =
    pick(payload, ["text", "message", "body", "messageText"]) ??
    pick(data, ["text", "message", "body", "messageText"]);
  if (!rawPhone) {
    // Nothing actionable, but acknowledge so the provider doesn't retry.
    return NextResponse.json({ ok: true, kind: "ignored" });
  }
  const phone = normalisePhone(rawPhone);

  // THE PROVIDER-SPECIFIC PART: this account has ONE number for every clinic, so
  // there is no receiving-number routing key — the sender is all we have, and the
  // search is cross-tenant by necessity. See `matchPatientAcrossPlatform` for why
  // that is safe and why it must not be "fixed" to be clinic-scoped.
  const matched = await matchPatientAcrossPlatform(phone);

  const result = await recordInboundMessage({
    clinicId: matched?.clinicId ?? null,
    patientId: matched?.id ?? null,
    phone,
    text: text ?? null,
    externalId: externalId ?? null,
    payload,
  });
  if (result.kind === "duplicate") return NextResponse.json({ ok: true, kind: "duplicate" });

  return NextResponse.json({
    ok: true,
    kind: "inbound",
    rescheduled: result.rescheduled,
    booked: result.booked,
    cancelled: result.cancelled,
  });
}
