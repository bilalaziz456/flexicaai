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
   clause of all three, through ONE shared predicate
   (`core/clinical/drafts.ts#draftAccessCondition`), not just hidden in the UI.
   Guarded by `scripts/test-draft-ownership.ts`.
   **The single exception (ADR-022):** a holder of the opt-in `handover` grant may
   also act on a draft whose author can no longer authenticate — deleted, suspended
   or purged. Without it such a draft is unreachable by everyone and its clinical
   content is lost in silence (D-18). It does NOT reach an active colleague's draft,
   and the record keeps both names: `doctor_id` dictated, `approved_by` signed.
   Guarded by `scripts/test-orphaned-drafts.ts`.
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
   ├─ INSERT visits: status='transcribing', audio_key
   └─ 202 { visitId }  ◄── THE REQUEST ENDS HERE (ADR-020)
        │
        │  after(() => runScribeJob(visitId))     Next 16, post-response
        ▼
core/ai/scribe-job.ts
   ├─ CLAIM the row (transcribing → started)     idempotent; paid work runs once
   ├─ runScribe()  ──► Whisper  (transcript + duration)
   │                └► Claude   (module prompt + transcript → JSON note)
   ├─ parseClinicalNote(note, module.noteSchema)  bounds + shape, before storing
   ├─ UPDATE visits: status='draft', note, ai_draft (frozen), transcript
   ├─ recordScribeUsage()                        ai_usage rows → serving cost
   └─ on ANY failure → status='failed' + a doctor-facing reason; audio kept
        │
        │  client polls getScribeStatus() until it leaves `transcribing`
        │  GET /api/cron/scribe-recover fails runs the process died inside
        ▼
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
| **Stall cutoff** | **15 min** | `SCRIBE_STALL_MINUTES`, `core/ai/scribe-job` |
| **Route ceiling** | 60s | `maxDuration` — now only bounds storing the upload |

**The provider budget must stay INSIDE the stall cutoff.** Whisper 120s + Claude 90s×2
is ~5 minutes worst case; the sweep gives up at 15. Raise a provider timeout past that
and the recovery cron will mark live runs as failed while they are still working.

**nginx no longer needs `proxy_read_timeout` raised for this route** — nothing here
holds a connection across the provider calls (ADR-020). **`client_max_body_size 25m`
is still required**, matching the upload cap, or a normal dictation is rejected at the
proxy before the app ever sees it.

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

## 6. The run is a JOB, not a request (ADR-020, 2026-08-22)

`POST` stores the audio, creates the visit as **`transcribing`** and returns **202**.
`core/ai/scribe-job.ts` does the Whisper + Claude work from Next's `after()` and lands
the result on the visit; the client polls `getScribeStatus` until it leaves that state.

**The four states:** `transcribing` → `draft` (the doctor reviews) → `approved`. A run
that cannot finish goes to **`failed`**, carrying a doctor-facing reason, and keeps its
recording so **Try again** costs a click rather than another dictation. Both new states
are invisible to every clinical surface by construction — they all filter `= 'draft'`
or `= 'approved'`.

**What the doctor sees:** an in-flight or failed run appears in *"Recordings being
written up"* on the scribe workspace, which self-refreshes while anything is in flight.
That card is not decoration — a background failure is no longer something the doctor
watches happen, so it has to be somewhere they will find it.

**Three rules hold this up:**

1. **Claim before you call.** The job leaves `transcribing` in its first statement, so
   a retry racing the recovery sweep does the PAID work once.
2. **Something must go looking.** Work not tied to a request has nothing to retry it,
   so `GET /api/cron/scribe-recover` marks stalled runs `failed`. It does **not**
   re-run them: billing a provider unasked, on a loop, is worse than waiting for a human.
3. **`coalesce(transcribe_started_at, created_at)`** in that sweep — a run whose
   `after()` never fired has a NULL start time, and `null < cutoff` is NULL, so the
   obvious comparison misses forever exactly the case it exists for.

**Not yet proven end to end:** with no Whisper/Claude keys, the state machine is tested
(`scripts/test-scribe-async.ts`; e2e asserts a run settles to `failed` with the audio
kept) but no real transcription has gone through this path. Do one live dictation when
the keys land.

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
