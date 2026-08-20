import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { patients, whatsappMessages } from "@/core/db/schema";
import { normalisePhone } from "@/core/integrations/whatsapp";
import { unscoped } from "@/core/db/tenant-guard";
import { getClinicIdByPhoneNumberId } from "@/core/notifications/clinic-whatsapp";
import { handleRescheduleReply } from "@/core/appointments/reschedule";
import { handleBookingReply } from "@/core/appointments/booking";
import { notifyInboundWhatsApp } from "@/core/notifications/triggers";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * Meta WhatsApp Cloud API webhook (per-clinic numbers). Unlike the AiSensy webhook,
 * this routes by the RECEIVING number: `metadata.phone_number_id` → clinic (a
 * clinic OWNS its number), then the patient is matched WITHIN that clinic. See
 * docs/whatsapp-cloud-plan.md.
 *
 *  - GET  → Meta's verification handshake (echo hub.challenge if the verify token
 *           matches).
 *  - POST → messages (inbound patient texts) + statuses (delivery/read receipts).
 *           Authenticity is checked via X-Hub-Signature-256 when WHATSAPP_APP_SECRET
 *           is configured.
 *
 * Always answers 200 on POST so Meta doesn't retry a payload we've already stored.
 */

const STATUS_MAP: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

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
      const phoneNumberId = value.metadata?.phone_number_id;
      // Route by the receiving number → clinic. Unknown number = ignore safely.
      const clinicId = phoneNumberId
        ? await getClinicIdByPhoneNumberId(phoneNumberId)
        : null;

      // ---- Delivery/read receipts: advance the outbound row by its wamid ----
      for (const s of value.statuses ?? []) {
        const mapped = s.status ? STATUS_MAP[s.status.toLowerCase()] : undefined;
        const wamid = s.id;
        if (mapped && wamid) {
          // Receipt matches the outbound row by its global wamid, across clinics.
          await unscoped("whatsapp cloud: match outbound by wamid", () =>
            db
              .update(whatsappMessages)
              .set({ status: mapped, updatedAt: new Date() })
              .where(eq(whatsappMessages.externalId, wamid)),
          );
          statuses++;
        }
      }

      // ---- Inbound messages: log + match a patient WITHIN the routed clinic ----
      for (const m of value.messages ?? []) {
        if (!m.from) continue;
        const phone = normalisePhone(m.from);
        const text = m.text?.body ?? null;

        const matched = clinicId
          ? await matchPatientInClinic(clinicId, phone)
          : null;

        // IDEMPOTENT INSERT. Meta redelivers a webhook whenever it doesn't get a
        // timely 200, and everything below this line has side effects the patient
        // can see — a replay used to be able to book a second appointment from one
        // message. `returning()` tells us whether WE wrote the row: an empty result
        // means the unique index rejected it as a duplicate, so this delivery has
        // already been handled and we skip straight past the side effects.
        const insertedRows = m.id
          ? await db
              .insert(whatsappMessages)
              .values({
                clinicId,
                patientId: matched,
                direction: "inbound",
                phone,
                status: "received",
                body: text,
                externalId: m.id,
                payload: value as Record<string, unknown>,
              })
              // `where` here is the CONFLICT TARGET predicate (DO NOTHING has only
              // one WHERE position). It must repeat the partial index's predicate,
              // or Postgres can't infer which index this conflict targets.
              .onConflictDoNothing({
                target: whatsappMessages.externalId,
                where: sql`${whatsappMessages.externalId} is not null and ${whatsappMessages.direction} = 'inbound'`,
              })
              .returning({ id: whatsappMessages.id })
          : await db
              .insert(whatsappMessages)
              .values({
                clinicId,
                patientId: matched,
                direction: "inbound",
                phone,
                status: "received",
                body: text,
                externalId: null,
                payload: value as Record<string, unknown>,
              })
              .returning({ id: whatsappMessages.id });

        // A message with no provider id can't be deduped — process it (the old
        // behaviour) rather than dropping it.
        if (insertedRows.length === 0) continue; // replay: already handled
        inbound++;

        // Self-service for a matched patient: reschedule, else book.
        let outcome: "booked" | "rescheduled" | "message" = "message";
        let apptId: string | null = null;
        if (clinicId && matched && text) {
          const resched = await handleRescheduleReply({ clinicId, patientId: matched, phone, text });
          if (resched.rescheduled) {
            outcome = "rescheduled";
            apptId = resched.appointmentId ?? null;
          } else if (!resched.handled) {
            const booking = await handleBookingReply({ clinicId, patientId: matched, phone, text });
            if (booking.booked) {
              outcome = "booked";
              apptId = booking.appointmentId ?? null;
            }
          }
        }
        // In-app bell: front desk (booking/reschedule) or whatsapp:view (message).
        await notifyInboundWhatsApp({ clinicId, patientId: matched, phone, text, outcome, appointmentId: apptId });
      }
    }
  }

  return NextResponse.json({ ok: true, inbound, statuses });
}

/**
 * Exact phone match within one clinic (clinic already known from the number).
 * Compares on DIGITS ONLY (Postgres `regexp_replace`) so stored formatting —
 * spaces, +, dashes — never breaks the match. Clinic-scoped, so the scan is small.
 *
 * ONE match or nobody. A household commonly shares a single mobile number — nothing
 * stops several patients being registered on it, and in this market that is the norm
 * rather than an edge case. This used to take the first row of a `LIMIT 1` with no
 * ORDER BY, so a shared number resolved to an arbitrary, not even deterministic,
 * family member. That id then drives self-service reschedule and booking, so a
 * mother texting "reschedule" could have moved her son's appointment.
 *
 * Returning null instead leaves the message unattributed in the WhatsApp queue for
 * staff to place, which is the same thing the legacy webhook does and the right
 * trade: a message a human has to route beats an appointment silently moved on the
 * wrong patient.
 */
async function matchPatientInClinic(
  clinicId: string,
  phone: string,
): Promise<string | null> {
  if (!phone) return null;
  const rows = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.clinicId, clinicId),
        notDeleted(patients.deletedAt),
        isNotNull(patients.phone),
        sql`regexp_replace(${patients.phone}, '[^0-9]', '', 'g') = ${phone}`,
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0].id : null;
}
