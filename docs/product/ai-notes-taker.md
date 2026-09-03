# AI Notes Taker

**Speak your notes. Review them. Approve them. Done.**

> For clinic owners and dentists. Technical detail lives in `.claude/ai-scribe.md`.

---

## What it does

After a consultation, the dentist taps record and describes the visit in their own
words — the way they would explain it to a colleague. FlexicaAI turns that into a
structured clinical note and puts it on the patient's record for review.

A finished note contains:

- **Chief complaint** — why the patient came in
- **Findings** — per tooth where relevant
- **Diagnosis**
- **Treatment performed** and **treatment plan**
- **Prescriptions** — drug, dosage, duration
- **Next visit** — reason and when, which schedules the recall automatically
- **Flags** — anything the dictation left unclear, raised rather than guessed

It works in the dentist's normal speaking style. There is no template to fill in and
no fixed phrasing to memorise.

## Nothing is saved without the dentist's approval

This is the part that matters most, so it is worth being direct about.

**Every note arrives as a draft.** It appears on screen for the dentist to read, edit
and approve. Until they approve it, it is not part of the patient's record. Nothing is
finalised automatically, and nothing is sent to a patient automatically.

Two further rules are built in, not optional:

- **A draft belongs to the dentist who dictated it.** No one else can approve it —
  not another dentist, not the clinic owner. The only exception is a colleague who has
  left the clinic, and even then a specific permission must be granted first.
- **Unclear audio is flagged, never guessed.** If the recording is muffled or a word is
  ambiguous, the note says so instead of inventing a plausible finding.

The record keeps both names: who dictated the note and who approved it.

## What you get from it

- **Notes get written.** The realistic alternative to a good note is not a worse
  note — it is no note, or one written from memory at 8pm.
- **Prescriptions come out of the note**, printable and sendable to the patient on
  WhatsApp as a PDF link.
- **Recalls schedule themselves.** "Review in six months" in the dictation becomes a
  scheduled recall, which is what brings the patient back.
- **The record is searchable and legible** — no handwriting, no missing pages.

## What it does not do

- It does not diagnose. It writes down what the dentist said.
- It does not decide treatment or dosage.
- It does not finalise anything on its own.
- It is not a replacement for the dentist's judgement, and it is not designed to be.

## What you need

- A tablet, laptop or phone with a microphone — a normal browser is enough
- A reasonably quiet room; ordinary surgery background noise is fine
- Nothing installed

## Privacy

Recordings and notes are stored against the patient's record in your clinic only.
Staff from other clinics cannot see them. Access is controlled by the permissions you
set. Recordings are kept so a note can be re-checked or re-run if needed.

## Setup

Switched on per clinic. Requires the AI service to be activated on your account — ask
your FlexicaAI contact. Once on, it is available immediately; there is nothing to
train and no setup on your side.
