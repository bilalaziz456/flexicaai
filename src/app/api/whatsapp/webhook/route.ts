import { NextResponse } from "next/server";
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { db } from "@/core/db";
import { patients, whatsappMessages } from "@/core/db/schema";
import { normalisePhone } from "@/core/integrations/whatsapp";
import { handleRescheduleReply } from "@/core/appointments/reschedule";
import { serverEnv } from "@/core/lib/env";

/**
 * POST /api/whatsapp/webhook — inbound WhatsApp from AiSensy (incoming patient
 * messages + delivery/read receipts). Secured by a shared token in the query
 * (?token=), configured on both sides. Everything is stored (raw payload kept)
 * so the receptionist queue (Step 11) has the full history. Provider payload
 * shapes vary, so extraction is defensive.
 *
 * Delivery receipts (status updates) advance the matching outbound row by its
 * provider id; incoming messages are logged and best-effort matched to a patient
 * by phone (only when exactly one patient across the platform has that number).
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

const STATUS_MAP: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "failed",
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
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

  const data = (payload.data ?? payload.message ?? payload) as unknown;
  const externalId =
    pick(payload, ["messageId", "id"]) ?? pick(data, ["messageId", "id"]);
  const statusRaw = (
    pick(payload, ["status"]) ??
    pick(data, ["status"]) ??
    ""
  ).toLowerCase();

  // ---- Delivery/read receipt: advance an existing outbound message ----
  const mappedStatus = STATUS_MAP[statusRaw];
  if (mappedStatus && externalId) {
    await db
      .update(whatsappMessages)
      .set({ status: mappedStatus, updatedAt: new Date() })
      .where(eq(whatsappMessages.externalId, externalId));
    return NextResponse.json({ ok: true, kind: "status" });
  }

  // ---- Incoming message: log it, best-effort matched to a patient ----
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

  // Attribute only when exactly one patient (platform-wide) has this number.
  const last9 = phone.slice(-9);
  const candidates = last9
    ? await db
        .select({ id: patients.id, clinicId: patients.clinicId, phone: patients.phone })
        .from(patients)
        .where(and(isNotNull(patients.phone), ilike(patients.phone, `%${last9}%`)))
        .limit(5)
    : [];
  const exact = candidates.filter((c) => normalisePhone(c.phone ?? "") === phone);
  const matched = exact.length === 1 ? exact[0] : null;

  await db.insert(whatsappMessages).values({
    clinicId: matched?.clinicId ?? null,
    patientId: matched?.id ?? null,
    direction: "inbound",
    phone,
    status: "received",
    body: text ?? null,
    externalId: externalId ?? null,
    payload,
  });

  // Self-service reschedule: a matched patient can reply "reschedule <date time>".
  let rescheduled = false;
  if (matched && text) {
    const outcome = await handleRescheduleReply({
      clinicId: matched.clinicId,
      patientId: matched.id,
      phone,
      text,
    });
    rescheduled = outcome.rescheduled;
  }

  return NextResponse.json({ ok: true, kind: "inbound", rescheduled });
}
