import { z } from "zod";

/**
 * Centralised, validated environment access.
 *
 * WHY: reading process.env directly scatters typos and missing-var bugs across
 * the codebase. We validate once here and fail fast with a clear message.
 *
 * With local Postgres there are NO public (browser) env vars — the browser
 * never talks to the database. Everything here is server-only; never import
 * this into a Client Component.
 */

const serverSchema = z.object({
  // Postgres connection string, e.g.
  // postgres://postgres:password@localhost:5432/flexicaai
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // AI keys — OPTIONAL so the app still boots without them. The scribe route
  // fails with a clear message if a call is attempted and its key is missing.
  ANTHROPIC_API_KEY: z.string().optional(), // Claude (note generation)
  OPENAI_API_KEY: z.string().optional(), // Whisper (transcription) — separate provider
  // Where uploaded audio is stored on disk for now (swap to S3 later). Relative
  // to the project root. Gitignored.
  STORAGE_DIR: z.string().default("./storage"),

  // Absolute base URL of this app — used to build public links (e.g. a
  // prescription PDF link sent over WhatsApp).
  APP_URL: z.string().url().default("http://localhost:3000"),

  // WhatsApp via AiSensy (WhatsApp Business API provider). OPTIONAL — the app
  // boots without it; send calls fail with a clear message and messages are
  // still logged (queued) so nothing is lost.
  AISENSY_API_KEY: z.string().optional(),
  AISENSY_API_URL: z
    .string()
    .url()
    .default("https://backend.aisensy.com/campaign/t1/api/v2"),
  // AiSensy campaign (maps to an approved template) used to deliver prescriptions.
  AISENSY_RX_CAMPAIGN: z.string().default("prescription"),
  // AiSensy campaign used for recall reminders (Step 10).
  AISENSY_RECALL_CAMPAIGN: z.string().default("recall_reminder"),
  // AiSensy campaign used to tell a patient their appointment was cancelled.
  AISENSY_CANCEL_CAMPAIGN: z.string().default("appointment_cancelled"),
  // AiSensy campaign confirming a booked appointment (with doctor/hours/fee).
  AISENSY_BOOKING_CAMPAIGN: z.string().default("appointment_booked"),
  // AiSensy campaign for the day-before appointment reminder.
  AISENSY_REMINDER_CAMPAIGN: z.string().default("appointment_reminder"),
  // AiSensy campaign for replies to a patient's WhatsApp reschedule request.
  AISENSY_RESCHEDULE_CAMPAIGN: z.string().default("reschedule_reply"),
  // AiSensy campaign for replies to a patient's WhatsApp booking request.
  AISENSY_BOOKING_REPLY_CAMPAIGN: z.string().default("booking_reply"),
  // AiSensy campaign to deliver an invoice / bill summary to a patient on WhatsApp.
  AISENSY_INVOICE_CAMPAIGN: z.string().default("invoice"),
  // AiSensy campaign for the "your crown/denture is ready" lab notification.
  AISENSY_LAB_CAMPAIGN: z.string().default("lab_ready"),
  // ---- WhatsApp via Meta Cloud API (multi-number; per-clinic sender) ----
  // Provider switch: "aisensy" (default, current single-number account) or
  // "cloud" (Meta Cloud API — one WABA token, a per-clinic phone_number_id chooses
  // the sending number). See docs/whatsapp-cloud-plan.md. OPTIONAL — unset = the
  // app boots and behaves exactly as before.
  WHATSAPP_PROVIDER: z.enum(["aisensy", "cloud"]).default("aisensy"),
  // System-user access token for the WABA (controls every clinic number). Optional.
  WHATSAPP_CLOUD_TOKEN: z.string().optional(),
  // The WhatsApp Business Account id that holds the clinic numbers + templates.
  WHATSAPP_WABA_ID: z.string().optional(),
  // Graph API version used for the Cloud API calls, e.g. "v21.0".
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  // Token echoed back on the Cloud API webhook verification (GET hub.challenge).
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  // Meta App Secret — verifies the X-Hub-Signature-256 on inbound Cloud webhooks.
  // When set, a bad/missing signature is rejected; unset = accept (dev only).
  WHATSAPP_APP_SECRET: z.string().optional(),

  // Secret protecting the cron endpoint that runs the recall engine. Vercel
  // sends it as `Authorization: Bearer <CRON_SECRET>` automatically.
  CRON_SECRET: z.string().optional(),
  // Shared secret AiSensy includes (?token=) when calling our inbound webhook.
  WHATSAPP_WEBHOOK_TOKEN: z.string().optional(),

  // HMAC secret for signing public, unguessable links (prescription PDFs sent
  // over WhatsApp). OPTIONAL — without it, public links are disabled.
  LINK_SIGNING_SECRET: z.string().optional(),

  // ---- Email (SMTP) — transactional email (password reset). OPTIONAL: without
  // host+user+pass the channel no-ops (logs), so the app boots the same. Works with
  // any SMTP provider (SES / Resend / Postmark / …). Go-live = set these at §Z. ----
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // The From header, e.g. "FlexicaAI <no-reply@flexicaai.com>". Falls back to SMTP_USER.
  EMAIL_FROM: z.string().optional(),
});

export const serverEnv = serverSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  STORAGE_DIR: process.env.STORAGE_DIR,
  APP_URL: process.env.APP_URL,
  AISENSY_API_KEY: process.env.AISENSY_API_KEY,
  AISENSY_API_URL: process.env.AISENSY_API_URL,
  AISENSY_RX_CAMPAIGN: process.env.AISENSY_RX_CAMPAIGN,
  AISENSY_RECALL_CAMPAIGN: process.env.AISENSY_RECALL_CAMPAIGN,
  AISENSY_CANCEL_CAMPAIGN: process.env.AISENSY_CANCEL_CAMPAIGN,
  AISENSY_BOOKING_CAMPAIGN: process.env.AISENSY_BOOKING_CAMPAIGN,
  AISENSY_REMINDER_CAMPAIGN: process.env.AISENSY_REMINDER_CAMPAIGN,
  AISENSY_RESCHEDULE_CAMPAIGN: process.env.AISENSY_RESCHEDULE_CAMPAIGN,
  AISENSY_BOOKING_REPLY_CAMPAIGN: process.env.AISENSY_BOOKING_REPLY_CAMPAIGN,
  AISENSY_INVOICE_CAMPAIGN: process.env.AISENSY_INVOICE_CAMPAIGN,
  AISENSY_LAB_CAMPAIGN: process.env.AISENSY_LAB_CAMPAIGN,
  WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
  WHATSAPP_CLOUD_TOKEN: process.env.WHATSAPP_CLOUD_TOKEN,
  WHATSAPP_WABA_ID: process.env.WHATSAPP_WABA_ID,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
  WHATSAPP_WEBHOOK_TOKEN: process.env.WHATSAPP_WEBHOOK_TOKEN,
  LINK_SIGNING_SECRET: process.env.LINK_SIGNING_SECRET,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE,
  EMAIL_FROM: process.env.EMAIL_FROM,
});

export const isProduction = serverEnv.NODE_ENV === "production";
