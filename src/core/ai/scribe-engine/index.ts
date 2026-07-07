import "server-only";

import { runJsonPrompt, MissingApiKeyError } from "@/core/ai/prompt-runner";
import { serverEnv } from "@/core/lib/env";

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

/** Whisper transcription — separate from Claude. Throws MissingApiKeyError if unset. */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
): Promise<string> {
  if (!serverEnv.OPENAI_API_KEY) {
    throw new MissingApiKeyError(
      "OPENAI_API_KEY is not set — add it to .env.local to transcribe audio.",
    );
  }

  const form = new FormData();
  // Node Buffer -> Blob for multipart upload.
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper transcription failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/** Turn a transcript into a module-shaped JSON note (draft). */
export async function generateNote(args: {
  scribePrompt: string;
  transcript: string;
}): Promise<{ note: Record<string, unknown>; raw: string }> {
  const { data, raw } = await runJsonPrompt<Record<string, unknown>>({
    system: args.scribePrompt,
    user: args.transcript,
  });
  return { note: data, raw };
}

/** Full run: audio -> transcript -> draft note. */
export async function runScribe(args: {
  audio: Buffer;
  filename: string;
  scribePrompt: string;
}): Promise<{ transcript: string; note: Record<string, unknown>; raw: string }> {
  const transcript = await transcribeAudio(args.audio, args.filename);
  if (!transcript) {
    throw new Error("Transcription was empty — please record again.");
  }
  const { note, raw } = await generateNote({
    scribePrompt: args.scribePrompt,
    transcript,
  });
  return { transcript, note, raw };
}
