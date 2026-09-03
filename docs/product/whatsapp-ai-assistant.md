# WhatsApp AI Assistant

**Patients write however they write. The assistant understands it anyway.**

> **Status: planned, not yet available.** This describes what is being built, so you
> can decide whether you want it. Do not present it to a clinic as something they can
> switch on today. Build plan: `docs/whatsapp-ai-plan.md`.

---

## The problem it solves

WhatsApp Messaging already lets a patient reschedule by texting
`reschedule 12 Jul 3pm`. That works — if the patient writes it that way.

Most do not. They write:

> *kal 4 baje aa sakta hun?*
> *appointment agay karwana hai*
> *how much is a root canal?*

Today those go to your front desk. That is safe, and it is not wrong — but it is
work someone has to do, and out of hours the patient waits until morning.

## What the assistant adds

**1. It understands messy messages.** Roman Urdu, mixed English, no fixed format. It
works out whether the patient wants to book, move or cancel, and what date and time
they mean.

**2. It confirms before it acts.** It does not move anything on a guess. It replies
with the request written out clearly and asks the patient to send it back:

> To book, reply with this message:
> `book 5 Sep 4:00pm`

If it misread them, the patient sees that immediately and simply does not send it.
**A misunderstanding costs one message, never a wrongly-moved appointment.**

**3. It can quote your prices.** If a patient asks the cost of a named treatment, it
answers from **your** price list — not a general one:

> Root canal treatment: from Rs 15,000 — indicative, and excludes consultation and
> anything else needed on the day. Final amount is confirmed at your visit.
> To book, reply: `book 8 Sep 4:00pm`

Prices come from the procedures you have entered. If it is not on your list, it does
not guess — the message goes to your staff.

**4. It can let patients cancel** — within a cutoff you set (for example, at least
four hours before). Later than that, the request goes to your front desk, so a
last-minute cancellation is still a conversation with a person.

## What it will never do

This is the part worth reading twice.

- **It never answers a medical question.** "Is my tooth pain serious?", "do I need a
  root canal?", "is this antibiotic safe for me?" — all go to a human, every time.
  There is no setting that changes this.
- **It never works out what treatment you need from your symptoms.** "How much is a
  root canal" gets a price. "How much to fix my broken tooth" does not — that needs
  an examination, so it goes to your staff.
- **It never invents a price.** Every figure comes from your own price list.
- **It never books or cancels on its own interpretation.** The patient always confirms.
- **It never leaves a message unanswered.** Anything outside the above reaches your
  front desk exactly as it does today.

## What you choose

Three switches, independent of each other:

| | What it does |
|---|---|
| **AI understanding** | The assistant reads free-form and Roman Urdu messages |
| **Price replies** | Patients can ask what a named treatment costs. Off by default |
| **Patient cancellation** | Patients can cancel themselves, within your cutoff. Off by default |

You can take any one without the others. Patient cancellation and price replies work
whether or not you take AI understanding.

## If you do not take it

Nothing you have today changes. Clear, formatted replies still book and reschedule
automatically; everything else reaches your front desk, exactly as now.

## Pricing

AI understanding costs us money for every message it reads, so unlike the rest of the
platform it is priced separately. Ask your FlexicaAI contact for current pricing.

Price replies and patient cancellation have no running cost and are not charged for.
