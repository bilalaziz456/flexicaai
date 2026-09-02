import "server-only";

import { and, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import { patients, whatsappMessages } from "@/core/db/schema";
import { normalisePhone } from "@/core/integrations/whatsapp";
import { handleRescheduleReply } from "@/core/appointments/reschedule";
import { handleBookingReply } from "@/core/appointments/booking";
import { notifyInboundWhatsApp } from "@/core/notifications/triggers";
import { enrichContext } from "@/core/observability";
import { whatsappDirectionId } from "@/core/db/vocabulary-seed";

/**
 * Inbound WhatsApp — CORE. Everything that happens to a message ONCE we know who
 * sent it, shared by both provider webhooks (delta D-10).
 *
 * There are two providers and they will not collapse into one route: AiSensy and the
 * Meta Cloud API authenticate differently, send different payload shapes, and — the
 * part that matters — identify the CLINIC differently. What was duplicated across
 * them was everything after that: the idempotent insert, the self-service intent, the
 * notification. About 120 lines, in two copies, drifting.
 *
 * So the split is: each route adapts its provider and resolves the sender; this
 * module owns the pipeline. Both resolution strategies live HERE too, side by side,
 * because the difference between them is a tenant-safety decision that must not be
 * "tidied up" by someone who only reads one of them.
 */

/** Delivery/read receipt states we track, across both providers' vocabularies. */
const STATUS_MAP: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "failed", // AiSensy's wording for the same thing
};

export type MatchedPatient = { id: string; clinicId: string };

/**
 * ── Strategy A: the CLOUD API (a number per clinic) ──
 * The clinic is already known from the receiving number, so the search is scoped to
 * it. Compares on DIGITS ONLY (`regexp_replace`) so stored formatting — spaces, +,
 * dashes — never breaks the match.
 *
 * ONE match or nobody. A household commonly shares a single mobile, and in this
 * market that is the norm rather than an edge case. Returning null on an ambiguous
 * number leaves the message unattributed for staff to place, which is the right
 * trade: a message a human has to route beats an appointment silently moved on the
 * wrong family member — and this id drives self-service reschedule and booking.
 */
export async function matchPatientInClinic(
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

/**
 * ── Strategy B: AiSensy (ONE number for the whole platform) ──
 * There is no per-clinic routing key to scope by — every clinic's patients text the
 * same number — so this searches ACROSS TENANTS by design, and the `unscoped()`
 * wrapper says so explicitly to the tenant guard.
 *
 * **Do not "fix" this to be clinic-scoped**: there is no clinic to scope it to at
 * this point, and the scoping is what the single-match rule provides instead. The
 * same ambiguity rule as Strategy A applies, and matters more here, since a
 * collision can now span clinics.
 *
 * Narrows on the last 9 digits (indexable-ish prefix match) and then compares in
 * full, so formatting differences can't produce a false match.
 */
export async function matchPatientAcrossPlatform(
  phone: string,
): Promise<MatchedPatient | null> {
  const last9 = phone.slice(-9);
  if (!last9) return null;
  const candidates = await unscoped(
    "whatsapp inbound: match patient by phone (no per-clinic number on this provider)",
    () =>
      db
        .select({ id: patients.id, clinicId: patients.clinicId, phone: patients.phone })
        .from(patients)
        .where(
          and(
            notDeleted(patients.deletedAt),
            isNotNull(patients.phone),
            ilike(patients.phone, `%${last9}%`),
          ),
        )
        .limit(5),
  );
  const exact = candidates.filter((c) => normalisePhone(c.phone ?? "") === phone);
  return exact.length === 1 ? { id: exact[0].id, clinicId: exact[0].clinicId } : null;
}

/**
 * Advances an OUTBOUND message by its provider id when a delivery/read receipt
 * arrives. Cross-clinic by necessity: the provider id is the only key we have, and
 * it is globally unique, so there is no clinic to scope by.
 * Returns true when the receipt was recognised.
 */
export async function applyDeliveryReceipt(
  externalId: string | undefined | null,
  rawStatus: string | undefined | null,
): Promise<boolean> {
  const mapped = rawStatus ? STATUS_MAP[rawStatus.toLowerCase()] : undefined;
  if (!mapped || !externalId) return false;
  await unscoped("whatsapp receipt: match outbound by provider id", () =>
    db
      .update(whatsappMessages)
      .set({ status: mapped, updatedAt: new Date() })
      .where(eq(whatsappMessages.externalId, externalId)),
  );
  return true;
}

export type InboundOutcome =
  | { kind: "duplicate" }
  | { kind: "handled"; booked: boolean; rescheduled: boolean; appointmentId: string | null };

/**
 * Logs an inbound message and runs whatever it asks for. The single pipeline both
 * providers feed.
 *
 * IDEMPOTENT: providers redeliver whenever they don't get a timely 200, and the
 * self-service handlers below can BOOK an appointment — so a replay must not run
 * them twice. The insert is `ON CONFLICT DO NOTHING` against the partial unique index
 * on inbound `external_id`; an empty result means we already handled this delivery,
 * and we return before any side effect. A message with no provider id can't be
 * deduplicated, so it is processed rather than dropped.
 */
export async function recordInboundMessage(msg: {
  clinicId: string | null;
  patientId: string | null;
  phone: string;
  text: string | null;
  externalId: string | null;
  payload: Record<string, unknown>;
}): Promise<InboundOutcome> {
  const { clinicId, patientId, phone, text, externalId, payload } = msg;
  // Everything reported for the rest of this run carries the clinic.
  if (clinicId) enrichContext({ clinicId });

  const values = {
    clinicId,
    patientId,
    direction: "inbound" as const,
    phone,
    status: "received" as const,
    body: text,
    externalId,
    payload,
  };
  const inserted = externalId
    ? await db
        .insert(whatsappMessages)
        .values(values)
        // `where` is the CONFLICT TARGET predicate; it repeats the partial index's
        // predicate so Postgres can infer which index this targets.
        .onConflictDoNothing({
          target: whatsappMessages.externalId,
          where: sql`${whatsappMessages.externalId} is not null and ${whatsappMessages.direction} = ${whatsappDirectionId("inbound")}`,
        })
        .returning({ id: whatsappMessages.id })
    : await db.insert(whatsappMessages).values(values).returning({ id: whatsappMessages.id });

  if (inserted.length === 0) return { kind: "duplicate" };

  // Self-service, for an attributed patient only. Reschedule is checked first;
  // booking runs only if the message wasn't a reschedule request.
  let rescheduled = false;
  let booked = false;
  let appointmentId: string | null = null;
  if (clinicId && patientId && text) {
    const resched = await handleRescheduleReply({ clinicId, patientId, phone, text });
    rescheduled = resched.rescheduled;
    if (resched.rescheduled) appointmentId = resched.appointmentId ?? null;
    if (!resched.handled) {
      const booking = await handleBookingReply({ clinicId, patientId, phone, text });
      booked = booking.booked;
      if (booking.booked) appointmentId = booking.appointmentId ?? null;
    }
  }

  // In-app bell: the front desk for a booking/reschedule, `whatsapp:view` otherwise.
  await notifyInboundWhatsApp({
    clinicId,
    patientId,
    phone,
    text,
    outcome: booked ? "booked" : rescheduled ? "rescheduled" : "message",
    appointmentId,
  });

  return { kind: "handled", booked, rescheduled, appointmentId };
}
