# AI providers — discussion notes (Claude, OpenAI, self-hosted Whisper)

*Discussion with the owner, 2026-10-16. Saved to pick up later; nothing here is built
yet and no decision has been taken. Figures were researched on 2026-10-16 — re-check
prices and benchmarks before relying on them.*

---

## 1. What each AI service does in the app today

Checked in the code: OpenAI is used in **exactly one place** —
`src/core/ai/scribe-engine/index.ts`, Whisper (`whisper-1`) turning the doctor's
recording into text. Everything else that uses AI runs on **Claude**: structuring the
dictation into the clinical note (`claude-sonnet-4-6`, pinned in
`core/ai/prompt-runner`) and the WhatsApp assistant (Haiku).

```
Doctor speaks  →  [1. speech → text]  →  [2. text → structured dental note]  →  doctor approves
                     OpenAI Whisper            Claude
```

**Why both:** Claude's API reads text, images and PDFs but **does not accept audio**, so
something else must do step 1.

---

## 2. The options discussed

### Claude only?
Not possible on its own — something must listen first. But step 1 need not be OpenAI;
it is one separate piece of code, so swapping it is contained.

| Step-1 option | Pros | Cons |
|---|---|---|
| **OpenAI Whisper** (today) | Cheap (~$0.006/min ≈ Rs 1.7), good with Urdu–English mixing | A second company, account and bill |
| **Another speech service** (Deepgram, AssemblyAI, Google, Azure, ElevenLabs) | Some faster or better on medical terms | Still a second company; Urdu quality varies — needs testing |
| **Whisper on our own server** | No second company; **patient audio never leaves our server**; no per-minute fee | Uses the server's processor (see §4) |

### OpenAI only? (Whisper + GPT, no Claude)
Possible — GPT can write the note and run the assistant. One company, key and bill.

| | Whisper + Claude (today) | OpenAI only |
|---|---|---|
| Companies / keys / bills | 2 | **1** |
| Clinical note | Claude | GPT — capable, but must be **re-tested** on real dictations |
| WhatsApp assistant | Claude Haiku | a cheap GPT model — equivalent |
| Structured data back | parsed carefully from text | can be forced into a guaranteed format — slightly more robust |
| Cost | low, similar | low, similar |
| Work to switch | none | moderate (below) |

**Why Claude is there today:** a project decision (CLAUDE.md §2, "AI reasoning:
Anthropic Claude API") for the quality of the clinical note — following a detailed
dental prompt, flagging unclear parts instead of guessing. Not a technical requirement.
(Note: these comparisons were written by Claude, so weigh its view of Claude-vs-GPT
accordingly.)

**Switching to OpenAI only would involve:** swapping the one AI connection
(`core/ai/prompt-runner`), updating usage metering (`core/ai/usage.ts`, so the owner's
cost/P&L stay right), re-testing the dental note prompt on real dictations (incl.
Urdu–English), and updating CLAUDE.md §2 to record the decision. Nothing changes for
doctors or clinics.

**Timing:** now is the cheapest moment to decide — no AI keys are configured and no
clinic is dictating, so nothing needs migrating.

---

## 3. Showing remaining credit, and a "credit low" alert

**Neither Anthropic nor OpenAI lets an app read the remaining balance** — both show it
only on their own website (long-standing feature requests, not added). So the app
cannot ask "how much is left?". Proposed design instead (not built):

1. **AI credit card for the super admin.** The super admin enters each top-up ("Claude:
   +$50 on 16 Oct"); the app counts down using its own record of every call
   (`ai_usage`: Whisper minutes, Claude tokens) → "about $31.40 left, ≈ 18 days at the
   current rate". If the estimate drifts, the super admin types the real figure from the
   provider's website once and the count continues from there.
2. **"Credit low" alert** when the estimate falls below a set level (e.g. $10 or < 7
   days): a warning in the admin panel and a notification.
3. **Instant "credit ran out" alert** — the most reliable part. When credit is gone the
   providers return a clear error ("credit balance too low" / "insufficient quota"); the
   app catches it and shows the super admin a red alert ("Claude credit has run out —
   voice scribe notes are failing"). Needs no estimate.

Also recommended, outside the app: switch on **automatic top-up** on both providers'
websites.

Open question for the owner before building: Whisper + Claude, or OpenAI only (one card
or two).

---

## 4. Self-hosting speech-to-text: Speaches

**Recommendation: [Speaches](https://github.com/speaches-ai/speaches)** — an open-source
(MIT) server that runs Whisper via **faster-whisper**.

- It offers the **same kind of transcription address as OpenAI's Whisper**, so the app
  switches mostly by changing one address in settings — not a rewrite.
- Runs well **without a graphics card**.
- Patient audio stays on our server; no per-minute fee.

### The server (checked 2026-10-16, read-only)

| Found | Meaning |
|---|---|
| 8 vCPU, AMD EPYC 9645 (KVM VPS), AVX2 + AVX-512 + FMA | Good — faster-whisper uses exactly these |
| 15 GB RAM, ~12 GB available | Enough — the turbo model needs ~2 GB |
| No GPU | Transcription runs on the processor: slower, fine because the scribe works in the background (ADR-020) |
| 468 GB free disk | Plenty |

**Model:** Whisper **large-v3-turbo** for the speed/accuracy balance — a 5-minute
dictation very roughly **1–3 minutes** on this CPU. Full **large-v3** is more accurate
(especially Urdu) but several times slower here.

**The real concern — sharing the processor.** This server also runs the test app, the
production app and Postgres. Mitigations: limit transcription to **4 of the 8 cores**,
run it at **lower priority**, transcribe **one recording at a time**. When many clinics
dictate all day, move it to **its own small server** (a one-address change).

**Keep Claude (or GPT) for the note.** Open-source language models (Llama, Qwen…) can
run here, but without a GPU they would be very slow and noticeably weaker at structured
clinical notes — not recommended for medical records. Suggested setup:

```
Doctor speaks → Speaches (our server, free, private) → Claude (note) → doctor approves
```

### Proposed steps (not started)

1. Make the transcription address a setting — OpenAI stays the default, nothing breaks.
2. Install Speaches on the server with the turbo model, the core limit and low priority
   (some steps need the owner's sudo password).
3. Test with real sample dictations (Urdu, English, mixed) against OpenAI's Whisper.
4. Switch the test server; production only when satisfied.

---

## 5. How accurate is it?

Speaches' accuracy **is the Whisper model's accuracy**. With the same model it matches
OpenAI's service — and OpenAI's `whisper-1` runs the **older large-v2**, so self-hosted
**large-v3** is as good or slightly better.

**Word error rate** (share of words wrong):

| Speech | Error rate (Whisper large) | Plain terms |
|---|---|---|
| Clear English | a few % | ~1–5 words wrong in 100 |
| Urdu, conversational | ~18% | ~1 in 5–6 |
| Urdu, read aloud | ~24–26% | ~1 in 4 |
| Urdu, FLEURS benchmark (large-v3) | ~21% | ~1 in 5 |

Weak spots: **names, English words inside Urdu sentences, numbers, drug names**. The
turbo model is slightly less accurate than full large-v3.

**What protects the record anyway:** Claude cleans up and structures the text; the
prompt flags unclear parts instead of guessing; drug names are checked against the
clinic's formulary; every note is a **draft the doctor approves** (ADR-007).

**Ways to improve accuracy:**
- Pass Whisper a **vocabulary hint** (dental terms, tooth numbers, frequent medicine
  brands) — helps precisely the words it gets wrong.
- Full **large-v3** for Urdu-heavy clinics, turbo for English-heavy ones, if speed allows.

**Recommendation:** decide by testing, not on paper — record ~10 dictations the way the
dentists really speak and compare OpenAI Whisper vs Speaches (turbo and large-v3) for
text quality and time.

---

## 6. Decisions still open

- [ ] Whisper + Claude, or **OpenAI only**?
- [ ] Keep OpenAI Whisper, or **self-host Speaches** (privacy, one fewer company)?
- [ ] Build the **AI credit card + alerts** (§3)?
- [ ] Run the **10-dictation accuracy test** (§5)?

## Sources

- [Feature request: Anthropic API balance endpoint](https://claudeissues.com/issue/26937-feature-request-add-api-balance-endpoint-to-retrieve-account-balance-information)
- [Expose organization API credit balance via Admin API (Anthropic)](https://claudeissues.com/issue/47574-expose-organization-api-credit-balance-to-statusline-scripts-and-via-admin-api)
- [Add API endpoint to check remaining credits (OpenAI community)](https://community.openai.com/t/add-api-endpoint-to-check-remaining-credits-or-balance-on-openai-account/1365221)
- [Why is there no API for account balance? (OpenAI community)](https://community.openai.com/t/why-is-there-no-api-for-account-balance/577584)
- [WER We Stand: Benchmarking Urdu ASR Models (arXiv)](https://arxiv.org/html/2409.11252v3)
- [Urdu voice benchmark (GitHub)](https://github.com/obaidullahjadoon0/urdu-voice-benchmark)
- [Whisper Large V3 Speech to Text Benchmark (Superwhisper)](https://superwhisper.com/benchmarks/whisper-large-v3)
- [Whisper-v3 Hallucinations on Real World Data (Deepgram)](https://deepgram.com/learn/whisper-v3-results)

In the code: `src/core/ai/scribe-engine/index.ts` (Whisper call), `src/core/ai/prompt-runner`
(Claude, model pinned), `src/core/ai/usage.ts` (metering), `.claude/ai-scribe.md` (the scribe
contract).
