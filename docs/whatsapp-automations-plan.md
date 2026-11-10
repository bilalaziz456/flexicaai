# WhatsApp automations — which messages the API sends, per clinic — plan

> **Owner-facing summary of ALL WhatsApp work** (what is sent, how the AI replies,
> providers, costs, plans, pending questions with answer dropdowns):
> https://claude.ai/artifact/Q4b91Wyj73DF9J4YcLGXSt — keep it in step when this file
> changes.

> Owner's request, 2026-11-10: "there are many places we send a message through the
> API, but it is up to the clinic — 5, 7, 10 or 14 of them should go through the API,
> and the clinic replies to the rest by hand."
>
> Status: **PLANNED, not started.** Builds on the existing WhatsApp code
> (`docs/whatsapp-ai-plan.md`, `docs/whatsapp-wetarseel-notes.md`) and pairs with the
> message credits (`docs/whatsapp-allowance-plan.md`).

## 1. Decisions (owner, 2026-11-10)

1. **Every automatic message or reply is its own on/off switch per clinic** — an
   "automation". On: the app sends it through the API. Off: the clinic's staff handle it
   by hand.
2. **Only the super admin or the clinic's account manager switches them.** The clinic
   admin sees which are on, but cannot change them.
3. **A main "WhatsApp API" switch per clinic.** On → every automation on. Off → every
   automation off, and nothing is sent through the API at all.
4. **A notice that is switched off goes on a "To send by hand" list** (recommended by
   us, accepted): each row has a button that opens the clinic's WhatsApp with the
   message already written, so staff only press send. It is free (not through the API),
   still comes from the clinic's own number, and no patient is forgotten.
5. **An incoming question whose reply is switched off goes to the staff queue**,
   labelled with what the patient asked ("asked about price").

## 2. The automations

17 today, read from the code. Each has a stable id. A new one added later joins the list
by being declared — no screen changes.

| # | Id | Automation | Group | Needs |
|---|---|---|---|---|
| 1 | `booking_confirmation` | Booking confirmation | Notices | — |
| 2 | `appointment_reminder` | Day-before reminder | Notices | — |
| 3 | `cancellation_notice` | Cancellation notice | Notices | — |
| 4 | `recall` | Recall (follow-up due) | Notices | — |
| 5 | `lab_ready` | Lab work ready (dental module) | Notices | — |
| 6 | `prescription_send` | Prescription — the Send button | Notices | — |
| 7 | `invoice_send` | Invoice — the Send button | Notices | — |
| 8 | `self_book` | Book by message | Patient self-service | — |
| 9 | `self_reschedule` | Reschedule by message | Patient self-service | — |
| 10 | `self_cancel` | Cancel by message | Patient self-service | — |
| 11 | `ai_understand` | AI reads free-form / Roman Urdu / Urdu messages | AI replies | — |
| 12 | `ai_price` | AI: procedure prices | AI replies | 11, the Sales feature |
| 13 | `ai_fee` | AI: doctor fees | AI replies | 11 |
| 14 | `ai_hours` | AI: opening hours | AI replies | 11 |
| 15 | `ai_location` | AI: clinic address | AI replies | 11 |
| 16 | `ai_book_help` | AI: help to book or reschedule (a line to copy) | AI replies | 11 and 8 or 9 |
| 17 | `ai_cancel_help` | AI: help to cancel | AI replies | 11 and 10 |

**"Needs" is enforced, not just shown:** with 11 off, 12–17 cannot be switched on (the
AI never reads the message, so there is nothing to answer with) and the paid Claude call
is skipped entirely. With 8, 9 or 10 off, the AI does not tell a patient to send a
message that nothing will act on.

**Core vs module (CLAUDE.md §4):** the catalog lives in core and never names a
specialty. `lab_ready` is contributed by the dental module through the registry, like
its scribe prompt — a derma clinic never sees it.

## 3. The switches

**Main switch "WhatsApp API"** (per clinic):
- Turned **on for the first time** → every automation the clinic may use is switched on.
- Turned **off** → nothing goes through the API; the clinic's selection is kept.
- Turned **back on** → the selection it had before comes back.

**An automation added to the app later** is OFF for clinics that already exist, until
the super admin or account manager switches it on — so a live clinic never starts
sending (and paying for) a new message type by surprise. A clinic whose API is switched
on for the first time after it exists gets it on, like every other option.

**The three existing switches fold in:** "WhatsApp AI assistant" → 11, "WhatsApp price
replies" → 12 + 13, "WhatsApp patient cancellation" → 10 + 17. A migration carries each
clinic's current setting across, so nothing changes for anyone on the day.

**Who changes them:** the super admin, or the account manager of that clinic
(`clinics.assigned_to`), under the admin `clinics:edit` capability — the same as the
clinic's other settings. Every change is written to the activity log (who, which
automation, on/off).

## 4. What "off" does

### Notices (1–7) → "To send by hand"

A notice that is off is not sent through the API. Instead a row is added to the
clinic's **To send by hand** list, at the moment the message would have gone:

| Notice | Appears |
|---|---|
| Booking confirmation, cancellation notice | When it happens |
| Day-before reminder | At the reminder run (evening before), for each appointment tomorrow |
| Recall | When the recall falls due |
| Lab work ready | When the case is marked received |
| Prescription, invoice | The Send button becomes **Send by hand**, which opens WhatsApp directly — no list row |

Each row shows the patient, what it is, the message text, and three buttons:
- **Open in WhatsApp** — opens the clinic's WhatsApp (desktop app or WhatsApp Web) on
  the patient's chat with the message typed in. Staff press send there.
- **Mark sent** — staff confirm it went; the row moves to the log as "sent by hand".
- **Skip** — not needed (patient called instead, etc.); stays in the log as skipped.

A row nobody acts on stops being useful (a reminder after the appointment): it expires —
reminders after the appointment time, confirmations after 7 days — and is shown as
expired, not deleted.

**Limits of "Open in WhatsApp":** it uses WhatsApp's own click-to-chat link, so it opens
whichever WhatsApp is signed in on that computer — it must be the clinic's number. The
message text travels in that link, so it carries only what the notice itself says (no
clinical detail); a prescription or invoice link inside it is the existing signed,
expiring one.

### Replies (8–17) → the staff queue

A patient message that would have been answered by an automation that is off gets no
automatic reply. It lands in the staff queue with a label for what it asked
("asked to reschedule", "asked about price"), and the front desk's bell rings as today.
Staff answer from the WhatsApp Business app.

With 11 off the AI never reads anything, so the label comes only from the fixed rules
(book / reschedule / cancel); other messages show as plain "new message".

## 5. Screens

**Super admin / account manager — clinic page, "WhatsApp automations" card**
- The main **WhatsApp API** switch.
- The automations in three groups, a switch each, with one line on what it does.
  Options the clinic cannot use are shown disabled with the reason ("needs 11 — AI
  reads messages", "needs the Sales feature").
- "Last changed by … on …".

**Clinic admin — WhatsApp page**
- Read-only: which automations are on, and "Contact your account manager to change
  these" with the manager's contact.
- The **To send by hand** list, with a count in the sidebar beside WhatsApp.

**Staff (who hold `whatsapp:view` / `whatsapp:create`)**
- The To send by hand list. "Open in WhatsApp" / "Mark sent" need `whatsapp:create`
  (already labelled "Send" in the access grid).

## 6. Changes

**Schema** — one migration:
- `clinics.whatsapp_api_enabled boolean` default false — the main switch.
- `clinics.whatsapp_automations text[]` — the ids switched ON (free-text tags, never an
  enum, so a module can add one without a schema change). Carries the three old switches
  across, then they are retired from `features_enabled`.
- `whatsapp_manual_sends` — `clinic_id`, `patient_id`, `automation` (id), `phone`, `body`,
  `appointment_id` / `recall_id` (nullable), `status` (`pending` | `sent` | `skipped` |
  `expired`), `expires_at`, `handled_by` / `handled_by_name` / `handled_at`, soft-delete
  columns.

**Core** — `core/notifications/whatsapp-automations.ts` (new):
- `AUTOMATIONS` — the core catalog; modules add theirs through the registry.
- `isAutomationOn(clinic, id)` — main switch ∩ the id ∩ its "needs".
- `queueManualSend(...)` — writes a To-send-by-hand row.

**The send path** — every place that sends today asks `isAutomationOn` first: on → as
today (and through the credits, when that is built); off → `queueManualSend` for a
notice, or no reply (queue + label) for a reply. One check per sender, not scattered
`if`s: `sendWhatsAppToPatient` takes the automation id and makes the choice itself.

**Daily jobs** — the reminder and recall runs still run for a clinic with them off, but
create To-send-by-hand rows instead of sending.

## 7. With the message credits

Only automations that are on use credits; messages sent by hand are free and never
count. A clinic that turns reminders off uses fewer messages. At zero credits an
automation that is on behaves like one that is off: its notices go to To send by hand
(so a clinic at zero still has every reminder ready to send), its replies to the queue.

## 8. Tests (`scripts/test-whatsapp-automations.ts`)

- Main switch off: nothing reaches the provider; every notice becomes a manual row.
- Each notice off → a manual row with the right text; on → sent as today.
- AI 11 off → no Claude call at all; 12–17 cannot be on without it.
- A reply automation off → no reply, the message labelled in the queue.
- First switch-on turns every allowed automation on; off and on again restores the
  selection; a newly added automation is off for an existing clinic.
- The migration carries the three old switches across exactly.
- A manual row expires; Mark sent / Skip record who and when.
- A clinic admin cannot change an automation (server refuses, not just hidden).

## 9. Phasing

1. Catalog + `isAutomationOn` + main switch + migration of the three old switches;
   the send path asks before sending (off = not sent yet). Tests.
2. Super admin / account manager card on the clinic page; read-only view for the clinic
   admin.
3. To send by hand: the table, rows from notices and daily jobs, the WhatsApp page list,
   Open in WhatsApp / Mark sent / Skip, expiry, the sidebar count.
4. Prescription and invoice "Send by hand"; queue labels for replies that are off.
