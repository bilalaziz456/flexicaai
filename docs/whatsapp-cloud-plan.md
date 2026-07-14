# Build plan — Per-clinic WhatsApp numbers (Meta Cloud API)

> Status: **planned, not started.** Needs the Meta/WABA setup (below) to run live,
> though Phases 1–4 can be built and tested against the Cloud API test number first.

## Goal
One WhatsApp Business Account (WABA) + one system token; **each clinic sends from its
own number**; patients see the clinic's number (not a generic platform number); and
clinics get **real message personalization** inside approved templates. The provider
swaps behind `core/integrations/whatsapp`, so the rest of the app is unchanged.

Why Cloud API (not AiSensy): AiSensy binds one API key to one sender number. Meta
Cloud API lets **one token control many numbers** under a single WABA; you pick the
sender per message via a `phone_number_id`. That is what makes "one API + per-clinic
numbers" possible.

---

## ⭐ Core design recommendation (personalization without per-clinic approvals)

**Design each template with a configurable signature/footer variable (and optionally
a per-event custom note) so clinics get real personalization inside approved
templates — without needing their own approvals.**

Rationale — what "customize" can and can't mean under WhatsApp's rules:

- ✅ **Variable values** are per-message data we control (clinic name, doctor, time).
- ✅ **A free-text signature/footer variable** (e.g. `{{signature}}`) and an optional
  **per-event custom note** variable (e.g. `{{note}}`) let a clinic inject their own
  branding/tone — set once in settings, passed as template params at send time.
- ❌ **The template wording/structure** cannot be freely rewritten and sent; changing
  the fixed copy requires a **new Meta-approved template**. Templates live at the WABA
  level and are **shared across all clinic numbers**, so one approval covers everyone.
- ⚠️ **Free-form (non-template) messages** are allowed only within the **24-hour
  service window** after a patient messages the clinic — so inbound auto-replies
  (reschedule/booking) may be worded more freely than proactive messages.

**Consequence for this plan:** every proactive template MUST include a trailing
`{{signature}}` variable, and events that benefit from it (booking, reminder, recall)
SHOULD include an optional `{{note}}` variable. This is the mechanism that gives
clinics real personalization with zero extra template approvals on their side.

---

## Phase 1 — Schema + config
- New `clinic_whatsapp` table (or columns on `clinics`):
  - `whatsapp_phone_number_id` — Meta phone-number id (the sender selector).
  - `whatsapp_display_number` — E.164, for inbound routing + display.
  - `whatsapp_sender_name` — display name patients see.
  - `whatsapp_signature` — the customizable footer (feeds `{{signature}}`).
  - `whatsapp_enabled` — derived/explicit on/off.
  - (optional) per-event `whatsapp_notes` jsonb — the `{{note}}` per event
    (booking/reminder/recall).
- Global env: `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_API_VERSION`,
  `WHATSAPP_VERIFY_TOKEN`. Secrets stay server-side; the token is system-level.
- Additive migration. Secrets encrypted at rest; never exposed to the client.

## Phase 2 — Cloud API provider adapter
- New adapter implementing the existing `sendWhatsAppTemplate` contract against
  `POST https://graph.facebook.com/v{ver}/{phone_number_id}/messages`
  (`type: template`; name + language + components; document header for the
  prescription template).
- Keep the same `SendResult` shape so **no caller changes**.
- `WHATSAPP_PROVIDER=cloud|aisensy` env switch — AiSensy stays as a fallback, not
  deleted.

## Phase 3 — Send-by-clinic wiring
- `sendWhatsAppToPatient` resolves the clinic's `phone_number_id` (it already has
  `clinicId`). No config → same graceful "logged as `queued`, not sent, never blocks"
  path as today.
- Feed per-clinic personalization into the template params: `{{signature}}` (always)
  and `{{note}}` (per event, when set). Event→param mapping stays in
  `core/notifications/*`.

## Phase 4 — Inbound routing by receiving number
- Cloud API webhook: `GET` verify (`hub.challenge` + `WHATSAPP_VERIFY_TOKEN`),
  `POST` messages/statuses.
- Payload carries `metadata.phone_number_id` → map to clinic → match patient **within
  that clinic** (fixes today's cross-clinic phone ambiguity). Advance delivery/read
  status by Meta's message id (`external_id`).

## Phase 5 — Customization + provisioning UI
- **Super admin:** per clinic, set `phone_number_id` + display number (after the
  number is verified in Meta).
- **Clinic admin (gated):** set **display name + signature/footer + optional per-event
  note** — the personalization that flows into templates (the ⭐ recommendation).
  In-UI note: *"You can personalize these fields; the message layout itself is a
  WhatsApp-approved template."*

## Phase 6 — Templates, verify, docs
- Document the required WABA-level templates: names, category = **Utility**, and
  param order — **each ending with a `{{signature}}` variable, and booking/reminder/
  recall also carrying a `{{note}}` variable** (per the ⭐ recommendation). Approved
  once, shared by all clinics.
- e2e: webhook verify handshake, inbound routing by `phone_number_id`, and the
  unconfigured-clinic graceful path.
- Update `.env.example`, `.claude/database.md`, `PROGRESS.md`.

---

## What's needed from the owner (outside the app, one-time)
- A **Meta Business account + business verification**, a **WABA**, and a **system-user
  token**.
- Each clinic's number **added to the WABA and verified** (OTP) — via Meta's Embedded
  Signup or manual add. The app then just stores the resulting `phone_number_id`.
- Meta's per-conversation pricing applies.

## Events that send today (all become per-clinic + personalized)
Booking confirmation, cancellation notice, day-before reminder (cron), recall
reminder (cron), prescription delivery, and the two inbound auto-replies (reschedule
/ new booking). See `core/notifications/appointment.ts`, `core/recall`,
`core/appointments/{booking,reschedule}.ts`, `app/doctor/actions.ts`.
