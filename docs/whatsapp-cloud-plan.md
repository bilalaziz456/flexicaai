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

> **Update (2026-07-15):** the per-event `{{note}}` feature was removed — it drove no
> real behaviour and confused users. Personalization is now the **signature only**
> (one trailing `{{signature}}` var on every template). Ignore `{{note}}` mentions
> below; column `whatsapp_notes` was dropped (migration 0030).

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
adapter appends the clinic's `{{signature}}` as the LAST variable. (The old per-event
`{{note}}` variable was removed — migration 0030 — so templates are **signature-only**.)

| Event · template (env) | Header | Body variables in order |
|---|---|---|
| Booking · `AISENSY_BOOKING_CAMPAIGN` (`appointment_booked`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` fee · `{{5}}` clinic · `{{6}}` queue token · `{{7}}` **signature** (the message states the appointment's own day/date/time only, NOT the doctor's weekly hours) |
| Cancellation · `AISENSY_CANCEL_CAMPAIGN` (`appointment_cancelled`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` clinic · `{{5}}` **signature** |
| Reminder · `AISENSY_REMINDER_CAMPAIGN` (`appointment_reminder`) | — | `{{1}}` patient · `{{2}}` doctor · `{{3}}` date & time · `{{4}}` clinic · `{{5}}` **signature** |
| Recall · `AISENSY_RECALL_CAMPAIGN` (`recall_reminder`) | — | `{{1}}` patient · `{{2}}` reason · `{{3}}` clinic · `{{4}}` **signature** |
| Reschedule reply · `AISENSY_RESCHEDULE_CAMPAIGN` (`reschedule_reply`) | — | `{{1}}` reply text · `{{2}}` **signature** |
| Booking reply · `AISENSY_BOOKING_REPLY_CAMPAIGN` (`booking_reply`) | — | `{{1}}` reply text · `{{2}}` **signature** |
| Prescription · `AISENSY_RX_CAMPAIGN` (`prescription`) | **document** (the PDF link) | `{{1}}` patient · `{{2}}` clinic · `{{3}}` **signature** |

Param sources in code: `core/notifications/appointment.ts` (booking/cancel/reminder),
`core/recall/index.ts` (recall), `core/appointments/{reschedule,booking}.ts` (replies),
`app/doctor/actions.ts` (prescription). The trailing signature is appended by
`core/integrations/whatsapp/cloud.ts`.

### C.1 Sample template bodies (ready to paste — category **Utility**, lang `en`)

Copy each into Meta's template editor. The last `{{n}}` is the **signature** (Cloud only —
**on AiSensy, delete that last line + variable**). A missing value renders as `—`
automatically (`sendWhatsAppTemplate` sanitizer), so ONE wording covers the
no-token / no-doctor cases — no variant templates needed.

**`appointment_booked`**
```
Hi {{1}}, your appointment at {{5}} is confirmed with {{2}} on {{3}}.
Consultation fee: {{4}}.
Queue token: {{6}}.

{{7}}
```
**`appointment_cancelled`**
```
Hi {{1}}, your appointment with {{2}} on {{3}} at {{4}} has been cancelled. Please contact us to rebook.

{{5}}
```
**`appointment_reminder`**
```
Hi {{1}}, a reminder of your appointment with {{2}} on {{3}} at {{4}}. See you soon.

{{5}}
```
**`recall_reminder`**
```
Hi {{1}}, it's time for {{2}}. Please contact {{3}} to book your visit.

{{4}}
```
**`invoice`**
```
Hi {{1}}, here is your bill from {{2}}.
Invoice: {{3}}
Total: {{4}} | Paid: {{5}} | Outstanding: {{6}}

{{7}}
```
**`prescription`** — add a **Document** header component (the PDF)
```
Hi {{1}}, your prescription from {{2}} is attached. Please follow the dosage as advised.

{{3}}
```
**`lab_ready`**
```
Hi {{1}}, good news — your {{2}} is back from the lab and ready to fit. Please call us to book your fitting.

{{3}}
```
**`booking_reply`** (auto-reply to an inbound "book…")
```
{{1}}
Reply to this message with a date & time to continue.

{{2}}
```
**`reschedule_reply`** (auto-reply to "reschedule…" + the confirmation)
```
{{1}}
Reply to this message with the new date & time to continue.

{{2}}
```

**Approval tips:** keep the fixed lines in `booking_reply` / `reschedule_reply` — Meta
often rejects a body that is *only* a variable. Don't start/end a body with a bare
variable. Keep every template **Utility** (no promotional wording).

## D. Blank / missing variables (mostly handled in code)

WhatsApp rejects a send whose body variable is blank / whitespace-only / has a newline —
and a template has a FIXED variable count, so params must match exactly, every time.

- ✅ **Empty EVENT variables → "—" (done, 2026-07-22).** `sendWhatsAppTemplate`
  (`core/integrations/whatsapp`) sanitizes every param — collapses whitespace, trims,
  and substitutes `—` for a blank — so the booking queue token `{{6}}`, a doctor-less
  booking, etc. never send an empty variable. **No "with/without" template split needed.**
- ✅ **`{{note}}` removed** (migration 0030) — templates are **signature-only**.
- ⚠️ **The trailing `{{signature}}` must ALWAYS be present.** Every template above ends
  with `{{signature}}`, so if a clinic hasn't set a signature the send is one param
  short → Meta rejects. Pick one:
  - **(a)** Require a signature per clinic in the provisioning UI (Phase 5), OR
  - **(b, recommended)** make the cloud send **fall back** to the clinic/sender name when
    the signature is blank, so `{{signature}}` is always filled regardless of what the
    clinic sets. (Small, localized change in `core/notifications/clinic-whatsapp.ts` /
    `cloud.ts`.)

This is the ONE remaining go-live decision on templates; everything else is wired.

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
