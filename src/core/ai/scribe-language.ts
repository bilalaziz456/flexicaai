/**
 * The languages a doctor can tell the scribe they are dictating in. PURE (no DB, no
 * server-only) so the scribe page's picker and the server's check are one list.
 *
 * Whisper detects the language from the first seconds of audio when it is not told,
 * and on a short or muffled clip it guesses wrong: a 4-second Urdu recording came back
 * as Spanish ("Hola, hola, hola", 2026-10-20). Telling it removes the guess. "Auto" stays
 * for a doctor who switches language visit to visit and would rather not choose.
 *
 * Codes are ISO 639-1, which is what Whisper (OpenAI's and a self-hosted Speaches) takes.
 */
export const SCRIBE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ur", label: "Urdu" },
] as const;

export type ScribeLanguage = (typeof SCRIBE_LANGUAGES)[number]["code"];

/** A submitted value as a known language, or null for "detect it" (anything else). */
export function asScribeLanguage(raw: unknown): ScribeLanguage | null {
  return SCRIBE_LANGUAGES.some((l) => l.code === raw) ? (raw as ScribeLanguage) : null;
}

/**
 * What AUTO falls back to when Whisper's own detection cannot be trusted
 * (core/ai/scribe-engine — transcribeAudio). Urdu: doctors here dictate Urdu, English or
 * both in one sentence, and transcribing as Urdu handled the mixed speech detection got
 * wrong (2026-10-24). One constant for now; a GCC clinic will want Arabic, at which point
 * this becomes a per-clinic setting rather than a second constant.
 */
export const SCRIBE_AUTO_FALLBACK: ScribeLanguage = "ur";
