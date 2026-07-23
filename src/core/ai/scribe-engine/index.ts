import "server-only";

import { runJsonPrompt, MissingApiKeyError, type ClaudeUsage } from "@/core/ai/prompt-runner";
import { serverEnv } from "@/core/lib/env";

/** Metered usage of one scribe run — for precise serving cost (core/ai/usage.ts). */
export type ScribeUsage = { audioSeconds: number; claude: ClaudeUsage };

/**
 * Scribe engine — CORE and GENERIC (CLAUDE.md §8). It turns audio into a
 * structured note in two provider-specific steps:
 *   1. Whisper (OpenAI — a SEPARATE provider from Claude) transcribes audio.
 *   2. The prompt-runner (Claude) turns the transcript into a JSON note using
 *      the ENABLED MODULE's prompt, which this engine receives as a string. It
 *      never knows dental from derma.
 * Every output is a DRAFT the doctor reviews and approves — never auto-final.
 */

export { MissingApiKeyError } from "@/core/ai/prompt-runner";

/** Whisper transcription — separate from Claude. Returns the text + audio duration
 *  (seconds, for cost metering). Throws MissingApiKeyError if unset. */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
): Promise<{ text: string; durationSeconds: number }> {
  if (!serverEnv.OPENAI_API_KEY) {
    throw new MissingApiKeyError(
      "OPENAI_API_KEY is not set — add it to .env.local to transcribe audio.",
    );
  }

  const form = new FormData();
  // Node Buffer -> Blob for multipart upload.
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", "whisper-1");
  // verbose_json so the response carries `duration` (audio seconds) for metering.
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}` },
    body: form,
  });

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
}): Promise<{ transcript: string; note: Record<string, unknown>; raw: string; usage: ScribeUsage }> {
  const { text: transcript, durationSeconds } = await transcribeAudio(args.audio, args.filename);
  if (!transcript) {
    throw new Error("Transcription was empty — please record again.");
  }
  const { note, raw, usage: claude } = await generateNote({
    scribePrompt: args.scribePrompt,
    transcript,
  });
  return { transcript, note, raw, usage: { audioSeconds: durationSeconds, claude } };
}
