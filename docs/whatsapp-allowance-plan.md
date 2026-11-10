# WhatsApp message credits per clinic — plan

> **Owner-facing summary of ALL WhatsApp work** (what is sent, how the AI replies,
> providers, costs, plans, pending questions with answer dropdowns):
> https://claude.ai/artifact/Q4b91Wyj73DF9J4YcLGXSt — keep it in step when this file
> changes.

> Owner's request, 2026-11-10: "the super admin can give each clinic a number of
> messages — Clinic001 bought 1,000, Clinic002 bought 500. After that many are sent,
> the automatic and AI messages stop and the clinic replies by hand. The clinic admin
> and the super admin both see how many were sent and how many are left."
>
> **Revised the same day** (owner): messages are CREDITS, not a monthly allowance.
> "It does not matter if it is for a month or 6 months" — the super admin gives a
> clinic any number of messages (300, 500, 1,000), and we must know whether each
> purchase is paid or not. The first version (a monthly allowance granted with each
> subscription payment) is superseded.
>
> Status: **PLANNED, not started.** Nothing here is built. It only starts to matter
> once WeTarSeel sending is connected (`docs/whatsapp-wetarseel-notes.md`), but the
> counting and the limit can be built before that — every send is already logged.

## 1. Decisions (owner, 2026-11-10)

1. **Messages are credits.** The super admin adds a **pack** of any size to a clinic
   (300, 500, 1,000 …). The clinic uses its credits until they are gone. No months, no
   periods, no link to the subscription.
2. **Credits never expire.** A pack bought in March is still good in December.
3. **No free messages.** The subscription includes none; every message the clinic
   sends comes from a pack.
4. **Every pack is paid or not paid.** A pack has a price, and payments are recorded
   against it later. Its status is derived: **Unpaid**, **Partly paid** or **Paid**.
5. **An unpaid pack can be used straight away.** Its credits work the moment it is
   added; what is owed is shown, and followed up like any other dues. Waiting for the
   money would stop the clinic's reminders in the meantime.
6. **What counts: every message the app SENDS** — booking confirmations, reminders,
   cancellations, recalls, lab-ready, prescriptions, invoices, self-service replies and
   AI replies. One sent message = one credit, whatever its length (Meta and WeTarSeel
   both charge per message, not per character). Incoming patient messages are free and
   never count. A FAILED send never counts.
   - Under Meta's pricing from 1 October 2026 each number gets 1,000 free replies a
     month (WhatsApp doc, Costs), so some counted messages cost us nothing. We still
     count them: the clinic buys "messages", not Meta's tiers, and the difference is
     margin.
7. **At zero, automatic sending stops** and patient messages wait in the staff queue.
   Exception: **cancellation notices are still sent**, so no patient misses that their
   appointment was cancelled. (These still count, and can take the balance below zero;
   the next pack makes that up first.)
8. **The clinic replies by hand from its own WhatsApp Business app**, not from
   FlexicaAI. This needs WeTarSeel to support coexistence (app + API on one number) —
   the most important question for them.

## 2. Open questions — ask when implementation starts

1. **The price of a pack.** Typed per pack, pre-filled from a company-wide rate per
   message (e.g. Rs 6 × 500 = Rs 3,000) that the super admin can change? Or fixed pack
   sizes with fixed prices? Recommended: any size, price pre-filled from the rate and
   editable. The rate must sit above what WeTarSeel charges us (~Rs 4.2 per message).
2. **Launch day.** With no free messages, every clinic starts at zero — so the day the
   limit is switched on, automatic messages stop for any clinic without a pack.
   Recommended: the limit is turned on per clinic, after its first pack is added; until
   then the clinic sends as today and its messages are only counted.
3. **Warning thresholds:** a notice at 80% used and at zero, or also at 50%? (With no
   period, "80% used" means 80% of the credits added so far, or simply "fewer than N
   left" — recommended: fewer than 20% of the last pack, and at zero.)

## 3. How it works

### The ledger: packs in, sends out

The balance is never a number someone types over. It is derived:

`balance = Σ messages in the clinic's packs (not voided) − Σ messages sent and counted`

- **Pack** — `messages`, `price`, the date it was added, who added it, a note. A
  correction is a pack with a negative number of messages and a reason, rather than an
  edit to an old pack.
- **Pack payment** — `amount`, method, reference, date, who recorded it. Several per
  pack (partial payments). `paid = Σ payments − refunds`; `owed = price − paid`.
- **Sends** — each counted outbound message is marked `counted` on `whatsapp_messages`.

No order between packs is needed: credits do not expire, so it does not matter which
pack a message "came from". The balance is one number.

### Why pack money is NOT a `clinic_payments` row

`core/admin/billing.ts#computeClinicBalance` treats every clinic payment as
subscription money: it is summed against the months accrued and moves `paid_through`.
A pack payment recorded there would silently pay subscription months. So pack payments
live with the pack, and the two are added together only where a total is shown:

- **Super admin, clinic page:** subscription owed · WhatsApp credits owed · total.
- **Due / overdue lists and follow-ups** (`listDueClinics`): a clinic with an unpaid
  pack shows there too, with the pack named, so it is chased with everything else.
- **P&L** (`core/admin/pnl.ts`): pack payments are collected revenue, a line of their
  own ("WhatsApp credits") beside subscriptions. The messages' cost is already in
  serving cost (`platform_cost_rates.whatsapp_msg_cost`).
- **The clinic's subscription status** (active / due / overdue) stays subscription-only:
  an unpaid pack does not make a clinic "overdue" on its plan.

### At send time

`core/notifications/whatsapp.ts#sendWhatsAppToPatient` is the one door every message
goes through. Before calling the provider it:

1. Takes a lock on the clinic's credit row (single node — a row lock in the same
   transaction is enough), reads the balance.
2. Balance > 0, or the message is a cancellation notice → claims one credit, sends.
3. Balance ≤ 0 → does **not** call the provider; logs the message as
   **`not sent — no WhatsApp credits`** so staff can see what the patient did not get.
4. A failed provider send gives the credit back (it was claimed, not used).

The **AI assistant checks the balance before its paid Claude call**: with nothing left
there is no reply to send, so we should not pay for the read either. Self-service and
AI messages then simply go to the staff queue, as with the AI off.

The daily **reminder and recall** runs skip a clinic at zero and leave its items
pending, so they go out on the next run after a pack is added — for a reminder, only if
the appointment is still tomorrow.

### Warnings

- Running low (question 3) and at **zero**: an in-app notice to the clinic admin and to
  the super admin (the clinic's account manager when it has one).
- An **unpaid pack**: shown on the screens below and in the due list; no separate notice.

## 4. Screens

**Super admin — clinic page, new "WhatsApp credits" card**
- Credits left · used · added in total
- **Add pack** (messages, price, note) — usable at once, paid or not
- Packs list: date · messages · price · paid · owed · status (Unpaid / Partly paid /
  Paid) · **Record payment** · void (to Trash)
- **Adjust** (± messages with a reason)

**Super admin — clinic list / Overview / due list**
- Columns: credits left · WhatsApp owed
- A clinic under 20% left or at zero is highlighted; an unpaid pack shows in the due list

**Clinic admin — WhatsApp page**
- "WhatsApp messages: 4,120 used · 1,880 left"
- The packs, each with its status (Paid / Unpaid / Partly paid) and what is owed
- This month by type: reminders, confirmations, recalls, AI replies, …
- At zero: a banner — "Automatic WhatsApp messages have stopped. Contact your account
  manager to add more." (with the manager's contact, `core/clinics/account-manager.ts`)
- Messages not sent for lack of credits are listed in the queue as such

## 5. Changes

**Schema** — one migration:
- `whatsapp_credit_packs` — `clinic_id`, `messages int` (negative for an adjustment),
  `price int` (PKR, 0 for an adjustment or a free goodwill pack), `kind`
  (`pack` | `adjustment`), `note`, `added_at`, `added_by` / `added_by_name`,
  soft-delete columns (voiding a pack is a soft delete; messages already sent stay
  counted).
- `whatsapp_credit_payments` — `clinic_id`, `pack_id`, `amount int`, `kind`
  (`payment` | `refund`), `method`, `reference`, `occurred_at`, `recorded_by(+name)`,
  soft-delete columns.
- `clinics.whatsapp_credits_enforced boolean` (default false; question 2) — the limit
  applies only once it is on.
- `whatsapp_messages.counted boolean` (default false) — this send used a credit.
  Indexed with `clinic_id` for the used-credits sum.
- A new message status `blocked_credits` beside `queued` / `sent` / `failed`.

**Core** (`core/notifications/whatsapp-credits.ts`, new): `getCredits(clinicId)`
(balance, used, packs with paid/owed/status), `claimCredit(tx, clinicId, template)`,
`releaseCredit(messageId)`, `addPack`, `adjustCredits`, `recordPackPayment`,
`voidPack`. Specialty-agnostic, `byClinic()` everywhere. Status math pure (no DB) so the
screens and the server agree.

**Billing hooks** — `listDueClinics` and the clinic page add WhatsApp owed beside the
subscription; `pnl.ts` adds pack payments to collected revenue as their own line.

**Send path** — `sendWhatsAppToPatient` claims before sending; `runAssistant` checks
before classifying; `sendDueAppointmentReminders` and `processDueRecalls` skip a clinic
at zero.

**ACL** — the super-admin card under the existing clinic billing capability; the clinic
admin's card under `whatsapp:view`. No new resource unless the owner wants the clinic's
figure hidden from some staff.

## 6. Tests (`scripts/test-whatsapp-credits.ts`)

- Balance = packs − counted sends; a voided pack stops counting, sends already made stay.
- An unpaid pack's credits are usable at once; its status moves Unpaid → Partly paid →
  Paid as payments are recorded, and back on a refund.
- Pack payments never change the subscription balance or `paid_through`.
- At zero: nothing reaches the provider, the message is logged as blocked; a
  cancellation notice still goes and the balance goes negative; the next pack makes it up.
- A failed send does not count.
- The AI assistant makes no paid call at zero.
- Two sends racing for the last credit: exactly one is sent.
- A clinic with the limit not yet on sends as today and only counts.

## 7. Phasing

1. Schema + the ledger + counting at send time + tests (counting only; nothing blocked).
2. Super-admin card: add pack, record payment, adjust, void; due list + P&L lines.
3. Turning the limit on per clinic; clinic admin card + banner; blocked messages in the
   queue; warnings.
4. Overview columns + highlight.
