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

---

# Phase 6 — Templates, env checklist & go-live (reference)

Phases 1–5 are built in code. This section is the operational reference to take it
live once you have a Meta WABA. **Status of the code:** P1 schema/config · P2 Cloud
adapter · P3 send-from-clinic-number + personalization · P4 inbound webhook · P5
provisioning + personalization UI — all committed. What remains is external (Meta
setup + approved templates) plus a live end-to-end test.

## A. Server env checklist (Vercel / host)

| Var | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `cloud` |
| `WHATSAPP_CLOUD_TOKEN` | system-user access token for the WABA |
| `WHATSAPP_WABA_ID` | the WhatsApp Business Account id |
| `WHATSAPP_API_VERSION` | e.g. `v21.0` |
| `WHATSAPP_VERIFY_TOKEN` | a random string — also entered in the Meta webhook config |
| `WHATSAPP_APP_SECRET` | the Meta App secret (enables `X-Hub-Signature-256` verification) |
| `APP_URL`, `LINK_SIGNING_SECRET` | already required (prescription PDF public links) |

**Meta webhook config:** callback URL = `https://<APP_URL>/api/whatsapp/cloud`,
verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to the **`messages`** field. Meta
calls `GET` to verify (we echo `hub.challenge`), then `POST`s messages + statuses.

## B. Per-clinic provisioning (repeat per clinic)
1. Add the clinic's number to the WABA in Meta and **verify** it (OTP); set a display name.
2. Copy its **`phone_number_id`**.
3. Super admin → the clinic → **WhatsApp sender (Cloud API)** → paste `phone_number_id`
   + display number + sender name → Save. (`phone_number_id` is unique per clinic.)
4. The clinic sets its **signature** and per-event **notes** on `/clinic/whatsapp`.

## C. Templates to create + get approved (WABA level, category **Utility**)

Approve ONCE at the WABA level — shared by every clinic number. The **template name**
is the value of the matching `AISENSY_*_CAMPAIGN` env var (reused as the Cloud
template name). The app sends these body variables **in this exact order**; the cloud
adapter appends the clinic's `{{note}}` (booking/reminder/recall only) then
`{{signature}}` as the LAST variables.

| Event · template (env) | Header | Body variables in order |
|---|---|---|
| Booking · `AISENSY_BOOKING_CAMPAIGN` (`appointment_booked`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` working hours · `{{5}}` fee · `{{6}}` clinic · `{{7}}` queue token · `{{8}}` **note** · `{{9}}` **signature** |
| Cancellation · `AISENSY_CANCEL_CAMPAIGN` (`appointment_cancelled`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` clinic · `{{5}}` **signature** |
| Reminder · `AISENSY_REMINDER_CAMPAIGN` (`appointment_reminder`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` clinic · `{{5}}` **note** · `{{6}}` **signature** |
| Recall · `AISENSY_RECALL_CAMPAIGN` (`recall_reminder`) | — | `{{1}}` patient · `{{2}}` reason · `{{3}}` clinic · `{{4}}` **note** · `{{5}}` **signature** |
| Reschedule reply · `AISENSY_RESCHEDULE_CAMPAIGN` (`reschedule_reply`) | — | `{{1}}` reply text · `{{2}}` **signature** |
| Booking reply · `AISENSY_BOOKING_REPLY_CAMPAIGN` (`booking_reply`) | — | `{{1}}` reply text · `{{2}}` **signature** |
| Prescription · `AISENSY_RX_CAMPAIGN` (`prescription`) | **document** (the PDF link) | `{{1}}` patient · `{{2}}` clinic · `{{3}}` **signature** |

Param sources in code: `core/notifications/appointment.ts` (booking/cancel/reminder),
`core/recall/index.ts` (recall), `core/appointments/{reschedule,booking}.ts` (replies),
`app/doctor/actions.ts` (prescription). The trailing note/signature are appended by
`core/integrations/whatsapp/cloud.ts`.

## D. ⚠️ The "always-present variable" rule (read before approving templates)

The cloud adapter appends `{{note}}` / `{{signature}}` **only when they are set**. A
WhatsApp template has a FIXED number of variables, so the params we send must match
the template exactly, every time. Therefore:

- **Signature:** make sure **every clinic sets a signature** (it's the last variable
  of every template). If a clinic leaves it blank, its messages would send one param
  short and Meta will reject them.
- **Note (booking/reminder/recall):** these templates carry a `{{note}}` variable, so
  the clinic must **always** have a note for those events — OR you omit the `{{note}}`
  variable from those templates for v1 and rely on `{{signature}}` only (then clinics
  must NOT set notes).

**Recommended v1:** ship **signature-only** templates (drop the `{{note}}` variable),
require a signature per clinic, and add `{{note}}` later. **Or**, before go-live, make
the adapter force non-empty trailing params (signature ← sender name; note ← a
placeholder) so counts are always stable regardless of what the clinic sets — decide
this during the live test, since it depends on Meta's handling of blank params. This
is the one code decision left; everything else is wired.

## E. Go-live steps
1. Set the Phase 6.A env vars; deploy.
2. In Meta: point the webhook at `/api/whatsapp/cloud`, verify, subscribe to `messages`.
3. Create + get the Phase 6.C templates approved (Utility) — respecting 6.D.
4. Provision one pilot clinic's number (6.B).
5. **Live test:** book/cancel an appointment for a test patient with a phone → confirm
   the message arrives FROM the clinic's number with its signature; reply "reschedule
   …"/"book …" → confirm the inbound webhook routes to the right clinic and the
   appointment moves; check delivery/read receipts land on the reception WhatsApp queue.
6. Roll out the remaining clinics' numbers.

## F. Rollback
Set `WHATSAPP_PROVIDER=aisensy` (or unset) to instantly revert to the single-number
AiSensy path — no code change, no data change. Per-clinic columns simply go unused.
