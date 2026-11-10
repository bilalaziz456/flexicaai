# Build plan — sending WhatsApp through WeTarSeel

> **Owner-facing summary of ALL WhatsApp work** (what is sent, how the AI replies,
> providers, costs, plans, pending questions with answer dropdowns):
> https://claude.ai/artifact/Q4b91Wyj73DF9J4YcLGXSt — keep it in step when this file
> changes.

> Owner, 2026-11-10: "write the WeTarSeel sending plan". Background, pricing and the
> questions put to WeTarSeel: `docs/whatsapp-wetarseel-notes.md`.
>
> Status: **PLANNED, not started.** Covers SENDING only — every message the app already
> sends today (confirmations, reminders, cancellations, recalls, lab-ready,
> prescriptions, invoices, booking/reschedule replies) going out from each clinic's own
> number through WeTarSeel. RECEIVING patient messages is a separate plan, written once
> WeTarSeel answers questions 3 and 4 (the webhook's shape and how it is secured).

## 1. What is known, and what this plan assumes

- **WeTarSeel's sending API is documented** (notes §2): base
  `https://app.wetarseel.ai/api/v1/`, header `Authorization: Bearer <key>`.
  - `POST /send-message` — a template at any time:
    `{ "to": "923451234567", "template_name": "...", "parameters": ["Ali", "INV-102"] }`
  - `POST /send-message-with-file` — a template with a file header (the prescription PDF).
- **Coexistence is available** (WeTarSeel, 2026-11-10), so each clinic keeps using its
  number in the WhatsApp Business app beside the API.
- **Assumed: Setup 1 — one WeTarSeel account (one API key) per clinic.** WeTarSeel has
  not yet said whether one account can hold several numbers (question 1). Setup 1 works
  either way; if they later confirm Setup 2 (one account, the send names the number),
  only the small part in §3 that picks the key changes.
- **Not known until we try:** the exact field names of `send-message-with-file`, the
  success body (where the message id is), and the error bodies. These are checked
  against WeTarSeel's documentation and one real send when building, not guessed here.

## 2. Decisions this plan makes (change any before building)

1. **WeTarSeel becomes a third provider** beside AiSensy and the Meta Cloud API, chosen
   platform-wide by `WHATSAPP_PROVIDER=wetarseel`. Nothing else in the app changes: every
   message still goes through `sendWhatsAppToPatient` → `sendWhatsAppTemplate`, which
   picks the provider. AiSensy and Cloud stay as they are (Cloud is the fallback if
   WeTarSeel falls through).
2. **Each clinic's API key is stored ENCRYPTED** in the database, never in plain text and
   never sent to the browser. Encrypted with AES-256-GCM using Node's built-in `crypto`
   and a server secret `WHATSAPP_KEY_SECRET` (no new library). Screens only ever show the
   last 4 characters. Why encrypt when the TOTP secret is not: one leaked database
   backup would otherwise let anyone send WhatsApp messages as every clinic, at our cost.
3. **Who sets the key:** whoever may set up the clinic's WhatsApp number today — the
   super admin and team members holding the admin `clinics:edit` capability
   (`/admin/clinics/[id]`). The clinic itself never sees or types the key.
4. **A clinic without a key does not send.** Its messages are logged as failed with
   "This clinic's WhatsApp is not set up yet", exactly as a Cloud clinic without a
   number is today. Nothing falls back to another clinic's number or a shared one.
5. **Templates must exist in EACH clinic's WeTarSeel account.** With one account per
   clinic, each account is its own WhatsApp Business account, and Meta approves
   templates per account. So the nine templates (names in `.env.example`, wording in
   the WhatsApp doc's "Message formats") are created and approved in every clinic's
   account, with the same names and the same blanks in the same order. This is a
   setup step per clinic (§6), not code.
6. **The clinic's signature is the last blank of every template**, as on the Cloud path
   (`getClinicSender` already works it out: signature → sender name → clinic name).
7. **No automatic retries.** A failed send is marked failed and shown in the queue. A
   retry after a timeout could send the patient the same message twice, and we cannot
   ask WeTarSeel whether the first one went until receiving (delivery status) exists.
8. **"Sent" means WeTarSeel accepted it.** Delivered / read / failed-later arrive only
   with the delivery-status webhook, which is part of receiving.
9. **Length limit enforced before sending.** Meta refuses a template body over 1,024
   characters. The booking and reschedule replies put the AI's answer in `{{1}}`, which
   can be long (a full price list), so `{{1}}` is shortened at the last full line that
   fits a 700-character budget (leaving room for the fixed wording and the signature),
   ending "… Reply for more." Every other blank is a short value and is left alone.
   This applies to every provider, so it lives in `sendWhatsAppTemplate`.

## 3. Changes

**Schema** — one migration (additive):
- `clinics.whatsapp_api_key_enc text` — the encrypted key (NULL = none).
- `clinics.whatsapp_api_key_last4 text` — for display only.
- `clinics.whatsapp_api_key_set_at timestamptz` + `whatsapp_api_key_set_by uuid` /
  `_set_by_name` — who changed it and when (also written to the audit log).

**Env** (`core/lib/env.ts`, `.env.example`):
- `WHATSAPP_PROVIDER` gains `"wetarseel"`.
- `WETARSEEL_API_URL` (default `https://app.wetarseel.ai/api/v1`).
- `WHATSAPP_KEY_SECRET` — 32 random bytes, base64. Required at the request boundary in
  production when the provider is `wetarseel` (fail the send loudly, not the build —
  conventions §8).
- The template names keep their current `AISENSY_*_CAMPAIGN` variables; they hold
  template names for every provider. (Renaming them is churn with no gain.)

**Core:**
- `core/lib/secret-box.ts` (new, `server-only`) — `sealSecret(plain)` /
  `openSecret(sealed)`, AES-256-GCM, random IV, versioned prefix (`v1:`) so the secret
  can be rotated later. Unit-tested.
- `core/integrations/whatsapp/wetarseel.ts` (new) — `sendViaWetarseel(args, apiKey)`:
  - no `media` → `POST /send-message` with `to` (digits), `template_name`, `parameters`
    (the template's blanks, then the signature);
  - `media` (the prescription PDF, a signed expiring link) → `POST /send-message-with-file`;
  - 15-second timeout (`AbortSignal.timeout`), so a hung provider cannot hold a booking;
  - returns the same `SendResult` as the other two; an error keeps the first 300
    characters of the response and never the key;
  - 401/403 → "WhatsApp key rejected by WeTarSeel" (`report()`ed, op
    `whatsapp.wetarseel.auth`, clinicId only), because every later send for that clinic
    will fail too and someone must replace the key.
- `core/integrations/whatsapp/index.ts`:
  - `sendWhatsAppTemplate` routes `wetarseel` to the new sender;
  - `isWhatsAppConfigured()` is true for `wetarseel` once `WHATSAPP_KEY_SECRET` is set
    (the per-clinic key is checked at send time, decision 4);
  - the 1,024 guard (decision 9).
- `core/notifications/clinic-whatsapp.ts` — `getClinicSender` also returns the clinic's
  opened API key (server-only; never leaves the server).
- `core/notifications/whatsapp.ts` — resolve the sender for `wetarseel` as it already
  does for `cloud`; a clinic with no key → failed with the message in decision 4.
- `core/clinics/whatsapp-key.ts` (new) — `setClinicWhatsappKey`, `clearClinicWhatsappKey`
  (seal, store last 4, audit-log "WhatsApp key changed" with no key in it).

**Screens** — `/admin/clinics/[id]`, the existing "WhatsApp sender" box:
- Heading follows the provider ("WhatsApp sender (WeTarSeel)").
- **API key**: a password field; when one is saved, shows "Key ending …a1b2, set 10 Nov by
  [name]" with **Replace** and **Remove**. Empty on submit = unchanged.
- **Send a test message** to a number the admin types, using the `lab_ready` template
  with sample values — proves the key, the number and the templates in one click. Logged
  like any other message.
- Display number and sender name stay as they are (used for display and, later, for
  routing incoming messages).

**ACL** — admin `clinics:edit`, the capability that guards the WhatsApp box today
(`updateClinic` in `app/admin/actions.ts`). The key gets its own Server Action
(`setClinicWhatsappKey`) under the same capability, so the general settings form never
round-trips the key.

## 4. Tests

- `scripts/test-secret-box.ts` — round trip; a tampered value is refused; the wrong
  secret is refused; two seals of one key differ (random IV).
- `scripts/test-wetarseel-send.ts` (against a local fake server, no real WeTarSeel):
  - the request carries `Bearer` + the clinic's key, the template name and the blanks in
    order with the signature last;
  - a PDF send uses `send-message-with-file`;
  - 401 → `ok:false` with the "key rejected" message, and the key is not in the error;
  - a timeout → `ok:false`, one request only (no retry);
  - a clinic without a key → the message row is `failed`, no request is made;
  - two clinics' sends use their own keys (no cross-clinic key).
- `scripts/test-whatsapp-length.ts` — a 3,000-character AI reply is cut at a line
  boundary under the budget and ends "… Reply for more."; short blanks are untouched.
- Typecheck, lint, and the existing WhatsApp tests unchanged.

## 5. Phasing

1. `secret-box` + migration + the admin key field (Replace / Remove, last 4) + tests.
2. The WeTarSeel sender, routing, the no-key failure, the length guard + tests against
   the fake server.
3. One real send on the TEST site with one clinic's real key and approved templates:
   confirm the success/error shapes and `send-message-with-file`'s fields, then fix the
   sender to match (decision log: what WeTarSeel actually returned).
4. The admin "Send a test message" button.

## 6. Setting up a clinic (operations, after the build)

1. Create the clinic's WeTarSeel account and connect its WhatsApp number (with
   coexistence, so the clinic keeps its WhatsApp Business app).
2. Create the nine templates in that account, same names and blank order as
   `.env.example` and the WhatsApp doc; wait for Meta's approval.
3. Paste the account's API key on `/admin/clinics/[id]` and press **Send a test message**.
4. Then the clinic's messages go out from its own number.

## 7. Questions to settle when building starts

1. **Test site first:** run the test site on `WHATSAPP_PROVIDER=wetarseel` with one
   real clinic's key, while production stays as it is? (Recommended.)
2. **The 700-character budget for an AI reply:** fine, or shorter for patients reading
   on a phone?
3. **One account per clinic** (assumed) — confirmed once WeTarSeel answers question 1.
