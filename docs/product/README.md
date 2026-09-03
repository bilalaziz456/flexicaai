# FlexicaAI — feature guides for clinics

Plain-language descriptions of what each feature does, written for a clinic owner
rather than an engineer. Each is self-contained, so one can be sent on its own.

| Guide | Feature | Status |
|---|---|---|
| [AI Notes Taker](ai-notes-taker.md) | Dictate a consultation; get a structured clinical note the dentist approves | Built — needs the AI service activated on the account |
| [WhatsApp Messaging](whatsapp-messaging.md) | Automatic confirmations, reminders, recalls, prescriptions, invoices, lab-ready | Built — needs a WhatsApp number and Meta template approval |
| [WhatsApp AI Assistant](whatsapp-ai-assistant.md) | Understands free-form and Roman Urdu messages; price replies; patient cancellation | **Planned, not built** |

---

## Before sending any of these to a clinic

**Check the Status column.** The AI Assistant guide describes work that has not been
built. It is written so the offer can be discussed and priced, not so it can be sold
as available. It says so at the top; do not remove that line.

**Two things are missing on purpose and need the owner's decision:**

- **Prices.** No figure appears in any guide. Nothing here should be given a price by
  whoever is editing the document.
- **The wording of a patient-facing price reply** (in the AI Assistant guide) is a
  draft. It is the sentence most likely to be screenshotted and quoted back, so the
  owner should approve the exact words.

**Claims are deliberately unquantified.** No guide says "saves two hours a day" or
"cuts no-shows by 30%", because no such measurement exists yet. Once there is real
usage data those numbers can be added — and until then, inventing them is the fastest
way to lose a clinic's trust in everything else the document says.

---

## The two rules that run through all three

They are worth knowing because clinics ask, and because they are engineering
guarantees rather than marketing language:

**1. A clinician approves anything clinical.** Every AI-written note is a draft until
the dentist who dictated it reviews and approves it. Nothing reaches a patient record
on its own.

**2. A machine never answers a medical question.** Not in the notes taker, not over
WhatsApp, not with any setting enabled. Questions about symptoms, diagnosis or
medication reach a person — always.

---

## Not covered here

These guides cover the three AI and messaging features. The rest of the platform —
appointments and the live queue, patient records, billing and invoicing, expenses and
P&L, doctor revenue shares, reports, trash and recovery — is not documented for
clinics yet.
