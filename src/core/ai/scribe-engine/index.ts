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

/** Whisper transcription — separate from Claude. Returns the text + audio duration
 *  (seconds, for cost metering). Throws MissingApiKeyError if unset. */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
  /** `language`: what the doctor said they dictate in (null = detect). `prompt`: words
   *  likely to be spoken — Whisper's documented way to steer spelling of names and
   *  terms (core/ai/scribe-vocabulary.ts). Both fields are honoured by OpenAI's Whisper
   *  and by Speaches alike. */
  opts: { language?: string | null; prompt?: string | null } = {},
): Promise<{ text: string; durationSeconds: number }> {
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
  // verbose_json so the response carries `duration` (audio seconds) for metering.
  form.append("response_format", "verbose_json");
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: serverEnv.OPENAI_API_KEY && !selfHosted ? { Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}` } : {},
      body: form,
      signal: AbortSignal.timeout(serverEnv.WHISPER_TIMEOUT_MS ?? WHISPER_TIMEOUT_MS),
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
  const json = (await res.json()) as { text?: string; duration?: number };
  return { text: (json.text ?? "").trim(), durationSeconds: Math.max(0, json.duration ?? 0) };
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
}): Promise<{ transcript: string; note: Record<string, unknown>; raw: string; usage: ScribeUsage }> {
  const { text: transcript, durationSeconds } = await transcribeAudio(args.audio, args.filename, {
    language: args.language,
    prompt: args.vocabulary,
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
