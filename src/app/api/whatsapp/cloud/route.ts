import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalisePhone } from "@/core/integrations/whatsapp";
import {
  applyDeliveryReceipt,
  matchPatientInClinic,
  recordInboundMessage,
} from "@/core/integrations/whatsapp/inbound";
import { getClinicIdByPhoneNumberId } from "@/core/notifications/clinic-whatsapp";
import { serverEnv, isProduction } from "@/core/lib/env";
import { report, withRequestContext } from "@/core/observability";

/**
 * Meta WhatsApp Cloud API webhook (per-clinic numbers). See docs/whatsapp-cloud-plan.md.
 *
 * An ADAPTER, like the AiSensy route: it verifies the signature, unwraps Meta's
 * envelope, and resolves the sender. Everything after that is the shared pipeline in
 * `core/integrations/whatsapp/inbound.ts` (delta D-10). What differs here is that a
 * clinic OWNS its number, so `metadata.phone_number_id` identifies the tenant and the
 * patient lookup is scoped to it — the safer strategy, available only because this
 * provider supplies a routing key.
 *
 *  - GET  → Meta's verification handshake (echo hub.challenge if the verify token
 *           matches).
 *  - POST → messages (inbound patient texts) + statuses (delivery/read receipts).
 *           Authenticity is checked via X-Hub-Signature-256 when WHATSAPP_APP_SECRET
 *           is configured.
 *
 * Always answers 200 on POST so Meta doesn't retry a payload we've already stored.
 */

/** Meta webhook verification (GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    mode === "subscribe" &&
    serverEnv.WHATSAPP_VERIFY_TOKEN &&
    token === serverEnv.WHATSAPP_VERIFY_TOKEN
  ) {
    // Meta expects the raw challenge string back, 200.
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Constant-time check of Meta's X-Hub-Signature-256 (sha256=<hmac of raw body>).
 *
 * FAILS CLOSED in production. With no WHATSAPP_APP_SECRET this endpoint is an
 * unauthenticated write path into `whatsapp_messages` that can also drive patient
 * self-service booking and rescheduling — anyone who knows the URL could forge an
 * inbound message and move a real appointment. Accepting unsigned payloads is a
 * DEV-ONLY convenience, so it is now scoped to dev; a production deploy that forgets
 * the secret gets 401s (a loud, fixable failure) instead of silently trusting the
 * internet. The env var stays optional so `next build` never breaks on it.
 */
function signatureOk(raw: string, header: string | null): boolean {
  const secret = serverEnv.WHATSAPP_APP_SECRET;
  if (!secret) return !isProduction; // unconfigured: dev accepts, production refuses
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(got, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

type CloudValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: {
    from?: string;
    id?: string;
    type?: string;
    text?: { body?: string };
  }[];
  statuses?: { id?: string; status?: string }[];
};

export async function POST(request: Request) {
  // A webhook has no user watching it either: if this handler throws, the symptom is
  // a patient message that silently never arrives. Wrapped so the run gets a
  // correlation id and any crash is reported. We still answer 200 on a crash — Meta
  // retries non-2xx, and a redelivery of a payload we already stored is pointless
  // (the insert is idempotent, but the retry storm is not free).
  return withRequestContext("webhook.whatsapp.cloud", request, async () => {
    try {
      return await handleCloudWebhook(request);
    } catch (e) {
      report(e, { op: "webhook.whatsapp.cloud" });
      return NextResponse.json({ ok: false }, { status: 200 });
    }
  });
}

async function handleCloudWebhook(request: Request) {
  const raw = await request.text();
  if (!signatureOk(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: CloudValue }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  let inbound = 0;
  let statuses = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // THE PROVIDER-SPECIFIC PART: this API gives each clinic its own number, so the
      // RECEIVING number identifies the tenant before we look at the sender at all.
      // An unknown number is ignored safely. (AiSensy has one number for everyone and
      // therefore resolves the other way round — see `matchPatientAcrossPlatform`.)
      const phoneNumberId = value.metadata?.phone_number_id;
      const clinicId = phoneNumberId
        ? await getClinicIdByPhoneNumberId(phoneNumberId)
        : null;

      // ---- Delivery/read receipts ----
      for (const s of value.statuses ?? []) {
        if (await applyDeliveryReceipt(s.id, s.status)) statuses++;
      }

      // ---- Inbound messages ----
      for (const m of value.messages ?? []) {
        if (!m.from) continue;
        const phone = normalisePhone(m.from);
        const result = await recordInboundMessage({
          clinicId,
          // Scoped to the routed clinic — the safer of the two strategies, and only
          // available because this provider gave us a clinic to scope to.
          patientId: clinicId ? await matchPatientInClinic(clinicId, phone) : null,
          phone,
          text: m.text?.body ?? null,
          externalId: m.id ?? null,
          payload: value as Record<string, unknown>,
        });
        if (result.kind === "handled") inbound++;
      }
    }
  }

  return NextResponse.json({ ok: true, inbound, statuses });
}
