import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics, patients, users } from "@/core/db/schema/identity";
import {
  WHATSAPP_DIRECTION_ROWS,
  whatsappDirectionId,
  WHATSAPP_STATUS_ROWS,
  CHAT_INTENT_ROWS,
  type WhatsappDirectionCode,
  type WhatsappStatusCode,
  type ChatIntentCode,
} from "@/core/db/vocabulary-seed";
import {
  whatsappDirections,
  whatsappStatuses,
  chatIntents,
  vocabularyRef,
} from "@/core/db/schema/vocabulary";

/**
 * Outbound and inbound messaging — the WhatsApp log and in-app notifications.
 *
 * Part of the schema split (delta D-09) — see `./index.ts`.
 */

/**
 * WhatsApp message log — shared/core. Every send is recorded (so nothing is lost
 * even when the provider is unconfigured) and every inbound message/status is
 * stored here. This is also the source for the receptionist's WhatsApp queue
 * (Step 11). `clinicId`/`patientId` are nullable because an inbound message from
 * an unknown number can't always be attributed yet.
 */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "cascade",
    }),
    patientId: uuid("patient_id").references(() => patients.id, {
      onDelete: "set null",
    }),
    direction: vocabularyRef<WhatsappDirectionCode>(WHATSAPP_DIRECTION_ROWS, "direction")
      .notNull()
      .references(() => whatsappDirections.id),
    // E.164-ish destination/sender (digits, country code included).
    phone: text("phone").notNull(),
    status: vocabularyRef<WhatsappStatusCode>(WHATSAPP_STATUS_ROWS, "status")
      .notNull()
      .default("queued")
      .references(() => whatsappStatuses.id),
    // AiSensy campaign / template used (outbound), if any.
    templateName: text("template_name"),
    // Human-readable body / preview text.
    body: text("body"),
    mediaUrl: text("media_url"),
    // Provider message id, for status correlation.
    externalId: text("external_id"),
    error: text("error"),
    /**
     * What the AI assistant read this INBOUND message as. NULL on outbound, and on
     * inbound whenever the assistant never ran — feature off, rate limited, or the
     * deterministic handler took it first, which is the common case.
     *
     * Recorded so `clinical` is countable rather than merged into `other`: how often
     * patients ask clinical questions is the number that decides whether triage is
     * ever worth building (docs/whatsapp-ai-plan.md).
     */
    intent: vocabularyRef<ChatIntentCode>(CHAT_INTENT_ROWS, "intent_id").references(
      () => chatIntents.id,
    ),
    // Raw provider payload, for debugging / audit.
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("wa_messages_clinic_id_idx").on(t.clinicId),
    index("wa_messages_patient_id_idx").on(t.patientId),
    index("wa_messages_phone_idx").on(t.phone),
    // The reception queue reads newest-first per clinic.
    index("wa_messages_clinic_created_idx").on(t.clinicId, t.createdAt),
    index("wa_messages_external_id_idx").on(t.externalId),
    // INBOUND idempotency. WhatsApp providers redeliver a webhook whenever they
    // don't get a timely 200 — and our handlers do real work (patient matching,
    // self-service reschedule/booking) before responding, so a slow batch invites a
    // retry. Without this, a replay logged the message twice AND could run
    // `handleBookingReply` twice, booking two appointments from one patient text.
    // The insert is now ON CONFLICT DO NOTHING against this index: no row inserted
    // means "already handled", and the handler skips the side effects.
    //
    // Scoped to inbound ON PURPOSE. Outbound rows also carry a provider id, but the
    // AiSensy sender picks it out of a loosely-typed response
    // (`messageId ?? id ?? submitted_message_id`); if that ever yielded a shared
    // value, a unique index spanning outbound would start REJECTING legitimate sends
    // at log time and break WhatsApp delivery. Inbound-only gets the dedupe with
    // none of that risk.
    uniqueIndex("wa_messages_inbound_external_id_unique")
      .on(t.externalId)
      .where(
        sql`${t.externalId} is not null and ${t.direction} = ${sql.raw(String(whatsappDirectionId("inbound")))}`,
      ),
  ],
);

/**
 * `notifications` — CORE, specialty-agnostic per-user in-app alerts (the bell). One
 * ROW per recipient (fan-out = many rows). TRANSIENT like `activity_logs`/`sessions`:
 * NOT soft-deleted and NOT in Trash; "dismiss" = mark read, old read rows pruned by an
 * optional cron. `type`/`entity` are free-text tags (never enums) so specialties add
 * none. Reads are self-scoped (`user_id = self`) AND clinic-scoped. See
 * `core/notifications/in-app.ts` + docs/notifications-plan.md.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL only for super-admin/platform notifications (v2); clinic staff rows are set.
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // free-text, e.g. discount.approval_needed | whatsapp.inbound
    title: text("title").notNull(),
    body: text("body"),
    entity: text("entity"), // appointment | patient | discount | payout | …
    entityId: uuid("entity_id"),
    link: text("link"), // precomputed in-app URL for the bell to navigate to
    // Who triggered it — snapshot (no FK; actors soft-delete). NULL for system events.
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name"),
    readAt: timestamp("read_at", { withTimezone: true }), // NULL = unread (source of truth)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unread count: a partial index so COUNT(*) for a user's unread is O(index).
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    // The bell list: a user's notifications, newest first.
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    // Tenant scans + prune.
    index("notifications_clinic_idx").on(t.clinicId),
  ],
);

export type Notification = typeof notifications.$inferSelect;

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
