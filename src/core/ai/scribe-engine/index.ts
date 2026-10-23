import "server-only";

import {
  runJsonPrompt,
  MissingApiKeyError,
  AiTimeoutError,
  type ClaudeUsage,
} from "@/core/ai/prompt-runner";
import { serverEnv } from "@/core/lib/env";

/** Metered usage of one scribe run — for precise serving cost (core/ai/usage.ts). */
export type ScribeUsage = { audioSeconds: number; claude: ClaudeUsage };

/**
 * Hard ceiling on the Whisper call. A bare `fetch` has NO timeout — a provider that
 * accepts the connection and then stalls holds the request until the hosting platform
 * kills the whole invocation, which the caller can't catch or report. 120s comfortably
 * covers a several-minute recording (Whisper is much faster than real time) while
 * turning a stall into a normal, reportable error.
 *
 * SCRIBE TIME BUDGET (must stay under the route's `maxDuration`, currently 300s):
 *   Whisper  120s  +  Claude 90s × 2 attempts (180s)  =  300s worst case.
 * Change one of these and re-check the other two.
 */
const WHISPER_TIMEOUT_MS = 120_000;

/** OpenAI's Whisper, unless WHISPER_BASE_URL points at a self-hosted one (Speaches). */
const OPENAI_WHISPER_URL = "https://api.openai.com/v1";

/**
 * Scribe engine — CORE and GENERIC (CLAUDE.md §8). It turns audio into a
 * structured note in two provider-specific steps:
 *   1. Whisper (OpenAI — a SEPARATE provider from Claude) transcribes audio.
 *   2. The prompt-runner (Claude) turns the transcript into a JSON note using
 *      the ENABLED MODULE's prompt, which this engine receives as a string. It
 *      never knows dental from derma.
 * Every output is a DRAFT the doctor reviews and approves — never auto-final.
 */

export { MissingApiKeyError, AiTimeoutError } from "@/core/ai/prompt-runner";

type Segment = { start?: number; end?: number; avg_logprob?: number; compression_ratio?: number };
type Pass = { text: string; durationSeconds: number; language: string | null; segments: Segment[] };

/**
 * When a detected result is trusted (2026-10-24). Measured on real dictations: a clean
 * English one scored -0.03 (average log-probability, weighted by length); every failure
 * — invented English for Urdu speech, looping, a misheard clip — scored -0.78 or lower.
 * A compression ratio above 2.4 is Whisper's own sign of a loop.
 */
const TRUSTED_LOGPROB = -0.5;
const LOOPING_COMPRESSION = 2.4;

function looksRight(segments: Segment[]): boolean {
  if (segments.length === 0) return true; // nothing to judge by — keep what came back
  let weight = 0;
  let sum = 0;
  for (const s of segments) {
    if ((s.compression_ratio ?? 0) > LOOPING_COMPRESSION) return false;
    const w = Math.max(0.01, (s.end ?? 0) - (s.start ?? 0));
    weight += w;
    sum += (s.avg_logprob ?? 0) * w;
  }
  return sum / weight >= TRUSTED_LOGPROB;
}

/** One request to the speech-to-text service, within `timeoutMs`. */
async function requestTranscription(
  audio: Buffer,
  filename: string,
  opts: { language?: string | null; prompt?: string | null },
  timeoutMs: number,
): Promise<Pass> {
  // A self-hosted server (WHISPER_BASE_URL) needs no OpenAI key; OpenAI itself does.
  const selfHosted = Boolean(serverEnv.WHISPER_BASE_URL);
  if (!selfHosted && !serverEnv.OPENAI_API_KEY) {
    throw new MissingApiKeyError(
      "OPENAI_API_KEY is not set. Add it to .env.local to transcribe audio.",
    );
  }
  const baseUrl = (serverEnv.WHISPER_BASE_URL ?? OPENAI_WHISPER_URL).replace(/\/+$/, "");

  const form = new FormData();
  // Node Buffer -> Blob for multipart upload.
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", serverEnv.WHISPER_MODEL ?? "whisper-1");
  // verbose_json: `duration` for metering, `language` and per-segment confidence for
  // the auto rule below. OpenAI's Whisper and Speaches return the same shape.
  form.append("response_format", "verbose_json");
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: serverEnv.OPENAI_API_KEY && !selfHosted ? { Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}` } : {},
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // AbortSignal.timeout() rejects with a TimeoutError DOMException; anything else
    // is a genuine network failure. Both are worth distinguishing for the doctor.
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new AiTimeoutError("Transcription timed out. Please try again.");
    }
    throw new Error(
      `Could not reach the transcription service: ${e instanceof Error ? e.message : "network error"}`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper transcription failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { text?: string; duration?: number; language?: string; segments?: Segment[] };
  return {
    text: (json.text ?? "").trim(),
    durationSeconds: Math.max(0, json.duration ?? 0),
    language: typeof json.language === "string" ? json.language.toLowerCase() : null,
    segments: Array.isArray(json.segments) ? json.segments : [],
  };
}

/**
 * Speech to text. Returns the text + audio seconds (for cost metering).
 *
 * With a `language`, one request in that language. Without one it is AUTO (owner's
 * call, 2026-10-24 — doctors here dictate Urdu, English, or both in one sentence):
 * Whisper detects, and the result is kept only if it came back confidently in English
 * or in the clinic's fallback language. Otherwise — Whisper guessing English for mixed
 * speech and inventing a sentence, or looping — it is transcribed again in the fallback
 * language (Urdu here), which handled real mixed dictation where detection failed.
 * ONE time budget covers both requests, so the job still ends inside the stall sweep.
 */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
  /** `language`: a fixed language (null = auto). `prompt`: words likely to be spoken
   *  (core/ai/scribe-vocabulary.ts) — English only, so only with `language: "en"`.
   *  `autoFallback`: the language auto falls back to (core/ai/scribe-language.ts). */
  opts: { language?: string | null; prompt?: string | null; autoFallback?: string | null } = {},
): Promise<{ text: string; durationSeconds: number }> {
  const deadline = Date.now() + (serverEnv.WHISPER_TIMEOUT_MS ?? WHISPER_TIMEOUT_MS);
  const remaining = () => Math.max(1_000, deadline - Date.now());

  if (opts.language || !opts.autoFallback) {
    const one = await requestTranscription(audio, filename, { language: opts.language, prompt: opts.prompt }, remaining());
    return { text: one.text, durationSeconds: one.durationSeconds };
  }

  const detected = await requestTranscription(audio, filename, {}, remaining());
  const trusted =
    detected.language === opts.autoFallback || (detected.language === "en" && looksRight(detected.segments));
  if (trusted) return { text: detected.text, durationSeconds: detected.durationSeconds };

  const again = await requestTranscription(audio, filename, { language: opts.autoFallback }, remaining());
  // Both requests are metered: a provider bills each one.
  return { text: again.text, durationSeconds: detected.durationSeconds + again.durationSeconds };
}

/** Turn a transcript into a module-shaped JSON note (draft). */
export async function generateNote(args: {
  scribePrompt: string;
  transcript: string;
}): Promise<{ note: Record<string, unknown>; raw: string; usage: ClaudeUsage }> {
  const { data, raw, usage } = await runJsonPrompt<Record<string, unknown>>({
    system: args.scribePrompt,
    user: args.transcript,
  });
  return { note: data, raw, usage };
}

/** Full run: audio -> transcript -> draft note, with metered usage. */
export async function runScribe(args: {
  audio: Buffer;
  filename: string;
  scribePrompt: string;
  language?: string | null;
  /** The vocabulary hint for speech-to-text (not the note prompt). */
  vocabulary?: string | null;
  /** The language AUTO falls back to when detection cannot be trusted. */
  autoFallback?: string | null;
}): Promise<{ transcript: string; note: Record<string, unknown>; raw: string; usage: ScribeUsage }> {
  const { text: transcript, durationSeconds } = await transcribeAudio(args.audio, args.filename, {
    language: args.language,
    prompt: args.vocabulary,
    autoFallback: args.autoFallback,
  });
  if (!transcript) {
    throw new Error("Transcription was empty. Please record again.");
  }
  const { note, raw, usage: claude } = await generateNote({
    scribePrompt: args.scribePrompt,
    transcript,
  });
  return { transcript, note, raw, usage: { audioSeconds: durationSeconds, claude } };
}
