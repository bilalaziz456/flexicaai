# WhatsApp message allowance per clinic — plan

> **Owner-facing summary of ALL WhatsApp work** (what is sent, how the AI replies,
> providers, costs, plans, pending questions with answer dropdowns):
> https://claude.ai/artifact/Q4b91Wyj73DF9J4YcLGXSt — keep it in step when this file
> changes.

> Owner's request, 2026-11-10: "the super admin can give each clinic a number of
> messages — Clinic001 bought 1,000, Clinic002 bought 500. After that many are sent,
> the automatic and AI messages stop and the clinic replies by hand. The clinic admin
> and the super admin both see how many were sent and how many are left."
>
> Status: **PLANNED, not started.** Nothing here is built. It only starts to matter
> once WeTarSeel sending is connected (`docs/whatsapp-wetarseel-notes.md`), but the
> counting and the limit can be built before that — every send is already logged.

## 1. Decisions (owner, 2026-11-10)

1. **What counts: every message that costs us** — everything the app SENDS through
   WhatsApp: booking confirmations, reminders, cancellations, recalls, lab-ready,
   prescriptions, invoices, self-service replies and AI replies. One sent message = one
   used. Incoming patient messages are free and never count. A FAILED send never
   counts.
   - Meta gives each number 1,000 free service replies a month, so some counted
     messages cost us nothing. We still count them: the clinic buys "messages", not
     Meta's tiers, and the difference is margin.
2. **The allowance follows what the clinic paid for.** Each clinic has a monthly
   allowance on its plan (Clinic001: 1,000/month, Clinic002: 500/month). Recording a
   subscription payment for N months adds N × the monthly allowance, valid for that
   paid period.
3. **One pool for the paid period, not a monthly reset.** Paid for 6 months at 1,000 →
   6,000 messages, usable at any pace until the period ends. Unused messages expire with
   the period.
4. **Ran out early? They buy more.** If the 6,000 are gone in 3 months, the clinic pays
   for an extra pack and the super admin adds it. Nothing tops up by itself.
5. **At zero, automatic sending stops** and patient messages wait in the staff queue.
   Exception: **cancellation notices are still sent**, so no patient misses that their
   appointment was cancelled. (These still count, and can take the balance below zero.)
6. **The clinic replies by hand from its own WhatsApp Business app**, not from
   FlexicaAI. This needs WeTarSeel to support coexistence (app + API on one number) —
   the most important question for them.

## 2. Open questions — ask when implementation starts

1. **"Continue and bill" as an option per clinic?** Instead of stopping at zero, keep
   sending and add the extra messages to the clinic's next subscription invoice at a set
   rate (e.g. Rs 6). The owner thinks this is not good, but asked to keep it as a
   question for build time.
2. **What a pack costs** and whether it is sold in fixed sizes (500 / 1,000 / 2,000) or
   any number.
3. **A clinic already paid up when this launches:** grant its current paid period
   automatically (from `paid_through` and its monthly allowance), or start it at zero
   until its next payment? Recommended: grant automatically, so nobody stops on launch
   day.
4. **A clinic with no allowance set:** recommended default 0 = nothing automatic is sent
   until the super admin sets one — the safe choice for our bill. Alternative: a platform
   default (e.g. 500/month).
5. **Warning thresholds:** 80% and zero, or also 50%?

## 3. How it works

### The ledger: grants in, sends out

The balance is never a number someone types over. It is derived from two lists:

- **Grants** — messages added: from a subscription payment (automatic), a pack, or a
  manual adjustment (with a reason). Each has a validity window.
- **Sends** — each counted outbound message, stamped with the grant it used.

`balance = what the active grants hold − what was sent against them`.

Each send uses the **grant that expires first** (first-to-expire, first-used), so a pack
bought mid-period is used only after the period's own messages — or the other way
round if the pack expires sooner. Nothing is lost by the order.

### When a grant is created

| Event | Grant | Valid |
|---|---|---|
| Super admin records a subscription **payment** covering N months | N × the clinic's monthly allowance | The months that payment covers (the stretch it pushes `paid_through` over) |
| Super admin adds a **pack** | The pack size | Until the clinic's current `paid_through` (or a date the admin picks) |
| Super admin **adjusts** (goodwill, correction) | ± any number, reason required | Like a pack |
| That payment is **refunded or deleted** (to Trash) | Its grant is voided; messages already sent stay counted | — |

A payment is recorded through the existing super-admin billing (`clinic_payments`,
`months_covered`), so the allowance needs no second step.

### At send time

`core/notifications/whatsapp.ts#sendWhatsAppToPatient` is the one door every message
goes through. Before calling the provider it:

1. Takes a lock on the clinic's allowance (single node — a row lock in the same
   transaction is enough), reads the balance.
2. Balance > 0, or the message is a cancellation notice → claims one from the
   first-to-expire grant, sends.
3. Balance = 0 → does **not** call the provider; logs the message as
   **`not sent — allowance used up`** so staff can see what the patient did not get.
4. A failed provider send gives the message back (it was claimed, not used).

The **AI assistant checks the balance before its paid Claude call**: with nothing left
there is no reply to send, so the clinic should not pay for the read either.
Self-service and AI messages then simply go to the staff queue, as with the AI off.

The daily **reminder and recall** runs skip a clinic at zero and leave its items
pending, so they go out on the next run after a top-up — for a reminder, only if the
appointment is still tomorrow.

### Warnings

- At **80%** used and at **zero**: an in-app notice to the clinic admin and to the
  super admin (the clinic's account manager when it has one).
- **30 days before** a paid period ends with messages unused: no notice (they expire
  by design); shown on the screens below instead.

## 4. Screens

**Super admin — clinic page, new "WhatsApp messages" card**
- Monthly allowance (editable) · Balance · Valid until
- **Add pack** (size, valid until, note) · **Adjust** (± with reason)
- History: every grant and its source (payment of 15 Nov, pack, adjustment), who added
  it, and how much of it was used

**Super admin — clinic list / Overview**
- Columns: allowance/month · used this period · left · valid until
- A clinic under 20% left or at zero is highlighted

**Clinic admin — WhatsApp page**
- "WhatsApp messages: 4,120 used · 1,880 left · valid until 30 Apr 2027"
- This month by type: reminders, confirmations, recalls, AI replies, …
- At zero: a banner — "Automatic WhatsApp messages have stopped. Contact your account
  manager to add more." (with the manager's contact, `core/clinics/account-manager.ts`)
- Messages not sent because of the limit are listed in the queue as such

## 5. Changes

**Schema** — one migration:
- `clinics.whatsapp_monthly_allowance int` (NULL = not set → treated as 0; question 4).
- `whatsapp_grants` — `clinic_id`, `kind` (`payment` | `pack` | `adjustment`),
  `messages int`, `valid_from date`, `valid_until date`, `clinic_payment_id` (nullable,
  for `payment`), `note`, `recorded_by` / `recorded_by_name`, soft-delete columns
  (`softDeleteColumns()`: voiding a grant is a soft delete).
- `whatsapp_messages.grant_id uuid` (nullable) — which grant paid for this send; NULL
  for inbound, failed and uncounted messages. Indexed for the per-grant usage sums.
- A new message status `blocked_allowance` beside `queued` / `sent` / `failed`.

**Core** (`core/notifications/whatsapp-allowance.ts`, new): `getAllowance(clinicId)`
(balance, valid until, by grant), `claimMessage(tx, clinicId, template)`,
`releaseMessage(messageId)`, `grantForPayment(paymentId)`, `addPack`, `adjust`.
Specialty-agnostic, `byClinic()` everywhere.

**Billing hook** — recording / refunding / deleting a clinic payment
(`core/admin/billing.ts`) creates / voids its grant in the same transaction.

**Send path** — `sendWhatsAppToPatient` claims before sending; `runAssistant` checks
before classifying; `sendDueAppointmentReminders` and `processDueRecalls` skip a clinic
at zero.

**ACL** — the super-admin card under the existing clinic billing capability; the clinic
admin's card under `whatsapp:view`. No new resource unless the owner wants the clinic's
figure hidden from some staff.

## 6. Tests (`scripts/test-whatsapp-allowance.ts`)

- A 6-month payment grants 6 × the allowance, valid for exactly those months.
- Sends use the first-to-expire grant; a pack is used in the right order.
- At zero: nothing reaches the provider, the message is logged as blocked; a
  cancellation notice still goes and the balance goes negative.
- A failed send does not count.
- The AI assistant makes no paid call at zero.
- A refunded payment voids its grant; messages already sent stay counted.
- Two sends racing for the last message: exactly one is sent.
- Expired grants hold nothing; a grant that starts in the future holds nothing yet.

## 7. Phasing

1. Schema + the ledger + counting at send time + tests (limit enforced, no screens yet).
2. Super-admin card: allowance, add pack, adjust, history; grants from payments.
3. Clinic admin card + banner; blocked messages shown in the queue; warnings.
4. Overview columns + highlight; the launch backfill (question 3).
