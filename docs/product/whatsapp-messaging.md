# WhatsApp Messaging

**Your clinic already talks to patients on WhatsApp. This makes it automatic, and
keeps a record of it.**

> For clinic owners and receptionists. Technical detail lives in
> `docs/whatsapp-cloud-plan.md`.

---

## What gets sent, automatically

| Message | When |
|---|---|
| **Booking confirmation** | As soon as an appointment is booked |
| **Day-before reminder** | The day before the visit |
| **Cancellation notice** | When an appointment is cancelled |
| **Recall reminder** | When a patient is due back — six-month cleaning, a review, whatever the dentist set |
| **Prescription** | A secure link to the prescription PDF |
| **Invoice / receipt** | With the total, what was paid, and what is outstanding |
| **Lab ready** | When a crown, denture or other lab work comes back |

Every message is logged against the patient, so the front desk can see exactly what
was sent and when. Nothing depends on someone remembering to do it.

## What patients can do by replying

Patients can reply in plain text to:

- **Reschedule** — "reschedule 12 Jul 3pm"
- **Book a new appointment** — "book 12 Jul 3pm"

The system checks the dentist's working hours, their leave, and their daily limit
before it moves or books anything — the same checks your receptionist's screen
applies. If the slot does not work, the patient is told, and nothing changes.

**Anything it does not understand goes to your front desk**, in the WhatsApp queue,
for a person to answer. A patient message is never left unanswered because software
did not recognise it.

Today this understands clear, English, date-and-time replies. Free-form messages and
Roman Urdu go to your staff — widening that is what the **WhatsApp AI Assistant** adds
(see `whatsapp-ai-assistant.md`).

## Why it is worth having

- **Fewer no-shows.** A reminder the day before is the single cheapest thing a clinic
  can do about empty chairs.
- **Recalls actually go out.** A six-month recall that depends on someone remembering
  usually does not happen. This one runs on its own.
- **The front desk stops re-typing.** Confirmations, reminders and receipts send
  themselves.
- **There is a record.** Every message in and out sits against the patient.

## What it does not do

- It does not give medical advice or answer clinical questions — those go to your
  staff, always.
- It does not message patients you have not recorded a phone number for.
- It does not send anything a patient has not been booked or treated for; there is no
  bulk marketing in this feature.

## What you need

- **A WhatsApp Business number** for the clinic, or use the platform's shared number
- **Approved message templates.** WhatsApp requires Meta to approve the wording of
  automated messages before any can be sent. There are nine. **Approval takes several
  days and is outside our control**, so this is the first thing to start, not the last.
- Patient phone numbers on file — the system uses what is already in the patient record

## A note on how WhatsApp works

WhatsApp does not allow businesses to send free-form messages whenever they like.
Automated messages must use wording Meta has approved in advance. Your clinic name,
signature and details go into those templates, so messages read as coming from you —
but the structure is fixed. This is a WhatsApp rule, not a FlexicaAI limitation.

## Setup

Switched on per clinic once your number and templates are approved. Your FlexicaAI
contact handles the submission; you provide the number and confirm the wording.
