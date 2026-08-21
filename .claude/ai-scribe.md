# The AI scribe — FlexicaAI

> The product's flagship feature and its highest-risk surface: it puts machine-written
> text into a medical record. Imported by root `CLAUDE.md` §8, which keeps the
> non-negotiables; this file is the full contract and implementation reference.
>
> Source of truth is the code — `core/ai/*`, `app/api/ai/scribe/route.ts`,
> `app/doctor/actions.ts`, `modules/*/prompts`. If this file disagrees, the code wins;
> fix this file in the same commit.

---

## 1. The rules that never bend

1. **Every AI output is a DRAFT.** A clinician reviews and approves before it becomes
   the record. Nothing auto-finalizes a note or a prescription — ever.
2. **Approval is gated on the `clinical:create` PERMISSION, not the `doctor` role.**
   In this market the clinic owner is usually the practising dentist. A role check
   here locks out the primary persona; that was a real bug, fixed 2026-08-21.
3. **A draft belongs to whoever dictated it.** Only its author reopens, approves or
   discards it — not another doctor, not the clinic admin. Enforced in the WHERE
   clause of all three (`eq(visits.doctorId, user.id)`), not just hidden in the UI.
   Guarded by `scripts/test-draft-ownership.ts`.
4. **The engine is generic.** `core/ai/*` receives a prompt string. It must never
   know dental from derma; the specialty lives in `modules/<id>/prompts`.
5. **Drug names are validated against the module formulary** before being shown, and
   cross-checked against the patient's recorded allergies.
6. **Unclear transcription is flagged, never guessed.**
7. **Every interaction is logged** — transcript, the model's original output, and the
   clinician's edits — for the accuracy flywheel.
8. **The note is validated before it is stored** — on the AI's output AND on the
   clinician's edited version, since both are untrusted producers writing `jsonb`.
   Core bounds it; the module declares the shape (`noteSchema` / `chartSchema`).
   Permissive by design — see `core/clinical/note-schema.ts` for why.
9. **No patient PII in logs or error reports.** Transcripts and notes are the most
   sensitive text in the system (`core/observability/redact.ts` masks them by key).

---

## 2. The flow

```
Doctor records (MediaRecorder, client)
        │  multipart: audio + patientId
        ▼
POST /api/ai/scribe                          app/api/ai/scribe/route.ts
   ├─ apiRequireWorkspace("clinical","create")   permission, not role (rule 2)
   ├─ throttle: 20 runs / 10 min per user        bounds PAID spend on a loop
   ├─ reject > 25 MB (Content-Length, then size) before buffering the body
   ├─ verify the patient belongs to THIS clinic  tenant boundary
   ├─ resolve the module prompt                  getClinicWorkspace(modules_enabled)
   ├─ saveClinicFile(audio)                      kept for the flywheel / re-runs
   ├─ runScribe()  ──► Whisper  (transcript + duration)
   │                └► Claude   (module prompt + transcript → JSON note)
   ├─ parseClinicalNote(note, module.noteSchema)  bounds + shape, before storing
   ├─ noteWarnings(note, formulary, allergies)   drug + allergy flags
   ├─ INSERT visits: status='draft', note, ai_draft (frozen), transcript, audio_key
   └─ recordScribeUsage()                        ai_usage rows → serving cost
        │
        ▼
Doctor reviews / edits in the workspace       app/doctor/scribe-workspace.tsx
        │
        ▼
approveVisit()                                app/doctor/actions.ts
   ├─ can(clinical:create) + author-only            re-checked server-side
   ├─ parseClinicalNote / parseClinicalChart        the EDITED note is untrusted too
   ├─ UPDATE visits SET status='approved', approved_by, note = the EDITED note
   ├─ module.saveRecord()                      specialty chart (best-effort, rebuildable)
   └─ scheduleRecall() from note.nextVisit     { reason, afterDays }
```

`ai_draft` keeps the model's original forever while `note` holds the clinician's
approved version. The diff between them **is** the accuracy flywheel — never
overwrite `ai_draft` on edit.

---

## 3. Module boundary

Core resolves the prompt through the registry and never names a specialty:

```ts
const workspace = getClinicWorkspace(clinic.modulesEnabled);
const scribePrompt = workspace.scribePrompts[moduleId];   // core stays agnostic
```

A clinic with no enabled module that ships a scribe prompt gets a clean 400, not a
crash. The dental prompt lives in `modules/dental/prompts/scribe.ts`; the formulary
it is validated against in `modules/dental/drug-formulary.ts`.

---

## 4. Providers, models, and cost

Two **different vendors**, deliberately: OpenAI Whisper transcribes, Anthropic Claude
structures. They fail independently and are keyed independently.

- **Scribe model: `claude-sonnet-4-6`** — quality matters on a clinical note. Pinned
  in ONE place (`core/ai/prompt-runner/index.ts`), so changing it is a one-line
  decision, not a search-and-replace.
- **Cheap model (Haiku) for simple WhatsApp auto-replies** — not for clinical text.
- Sonnet 4.6 does not support structured-output formats, so the prompt constrains the
  shape and `extractJson()` parses defensively: it scans for the first *balanced*
  JSON object, tolerating a model that wraps it in prose or code fences. A genuinely
  unparseable response raises `AiParseError`, never a silent empty note.
- **Both calls are metered** into `ai_usage` (Whisper by audio-second, Claude by
  token) so the company P&L reflects real serving cost rather than an estimate.
  Best-effort — but reported, because unrecorded usage understates cost and makes
  margins look better than they are.

**API keys are optional.** With none set the app boots and the route answers a clear
400 (`MissingApiKeyError`), so the rest of the product is usable and testable.

---

## 5. The time budget (and why it is fragile)

Two slow paid calls run back to back. Real dictation is minutes of audio.

| Stage | Budget | Where |
|---|---|---|
| Whisper | 120s | `WHISPER_TIMEOUT_MS`, `core/ai/scribe-engine` |
| Claude | 90s × 2 attempts | `CLAUDE_TIMEOUT_MS` + `maxRetries: 1`, `core/ai/prompt-runner` |
| **Route ceiling** | **300s** | `maxDuration`, `app/api/ai/scribe/route.ts` |
| **nginx** | **must be ≥ 300s** | `proxy_read_timeout` — default is **60s** |

**These four numbers are one chain.** Change one, re-check the others. The nginx line
is the one that bites: `maxDuration` is a serverless hint and does nothing under
`next start`, so on the Linux deployment nginx's 60s default is the real ceiling and
would cut off a normal dictation with the audio already stored and the APIs already
billed. Also set `client_max_body_size 25m` to match the upload cap.

Without an explicit timeout the Anthropic SDK defaults to **10 minutes with 2
retries** — a hung provider could hold a request ~30 minutes. That is why the client
is constructed with both values.

### Failure taxonomy

| Condition | Status | Meaning |
|---|---|---|
| `MissingApiKeyError` | 400 | Not configured — fix the environment |
| `AiParseError` | 502 | Model returned unusable JSON — retry is reasonable |
| note fails validation | 502 + `retryable: true` (AI path) / error string (approve path) | The shape can't be stored; nothing is written |
| `AiTimeoutError` | 504 + `retryable: true` | Provider too slow; **audio is saved**, so the client offers retry without re-recording |
| over 25 MB | 413 | Rejected before buffering |
| over 20 runs / 10 min | 429 + `Retry-After` | Bounds paid spend |

`AiTimeoutError` is declared in `prompt-runner` and the SDK's own timeout type is
translated into it there, so no caller ever imports the Anthropic SDK. That module is
the single place the vendor is known.

---

## 6. Current shape vs. target

**Today the run is synchronous** — the doctor's request stays open for the whole
Whisper + Claude round trip. The timeouts make that survivable, not correct: it holds
a request open for minutes on a single-node server and there is no resume path if it
dies.

**Target (ADR-020):** `POST` persists the audio and returns a visit in a
`transcribing` state; a job performs the run and fills the draft; the client
revalidates. Add one `visits.status` value — the state machine already exists — not a
new table.

---

## 7. When adding a specialty

Only these change:

1. `modules/<id>/prompts/scribe.ts` — the system prompt. Ask for JSON only, and for a
   `nextVisit: { reason, afterDays }` if that specialty has recalls.
2. `modules/<id>/drug-formulary.ts` — what prescriptions validate against.
3. `modules/<id>/config.ts` — register the prompt, formulary, and any clinical record.
4. `config/modules.ts` — add it to `MODULES`.

**Zero changes in `core/ai`.** If the engine needs to change to add a specialty, the
prompt contract is wrong — fix the contract, not the engine.
