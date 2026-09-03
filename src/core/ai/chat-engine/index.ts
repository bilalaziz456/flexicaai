import "server-only";

import { CHAT_MODEL, runJsonPrompt } from "@/core/ai/prompt-runner";
import { buildClassifierPrompt, type PromptProcedure } from "@/core/ai/chat-engine/prompt";
import { parseClassification, type ChatClassification } from "@/core/ai/chat-engine/schema";
import { report } from "@/core/observability";

export type { ChatClassification, ChatIntent } from "@/core/ai/chat-engine/schema";
export type { PromptProcedure } from "@/core/ai/chat-engine/prompt";

/**
 * The generic WhatsApp classifier — CORE (the `chat-engine` slot CLAUDE.md §3 has
 * held open since project setup).
 *
 * It answers ONE question: what is this message asking for? It does not reply, does
 * not decide anything, and does not write. Its answer either selects a lookup or
 * produces a suggestion the patient must confirm before anything happens — which is
 * why a cheap model is appropriate here and would not be for clinical text.
 *
 * SPECIALTY-AGNOSTIC. The only clinical vocabulary it sees is the clinic's own
 * procedure names, passed in by the caller. Nothing dental is named here, so a derma
 * clinic would use this unchanged.
 */

/** How long a patient message may be before we stop paying to classify it. */
export const MAX_CLASSIFIABLE_CHARS = 400;

/** The shape of `runJsonPrompt`, so a test can supply its own without a module mock. */
export type JsonPromptRunner = typeof runJsonPrompt;

/**
 * A cheap pre-filter, applied BEFORE spending anything.
 *
 * This is an unauthenticated, patient-triggered paid call: anyone who can message the
 * clinic can cause one. Length is the crude half of bounding that (the limiter is the
 * other half, at the call site). A message with no letters — a sticker caption, an
 * emoji, a bare number — cannot be a request worth classifying.
 */
export function worthClassifying(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  return t.length > 1 && t.length <= MAX_CLASSIFIABLE_CHARS && /[a-z]/i.test(t);
}

/**
 * Classify one inbound message. Returns null when it cannot be classified for ANY
 * reason — no key, provider error, timeout, malformed output, an id we did not offer.
 *
 * NULL IS NOT AN ERROR PATH, it is the normal one: the caller falls back to exactly
 * what happens today, which is that a human reads the message. Every failure of this
 * function must be no worse than not having called it.
 */
export async function classifyMessage(
  args: {
    text: string;
    /** The clinic's today, as YYYY-MM-DD, so relative dates resolve correctly. */
    today: string;
    /** The clinic's ACTIVE priced procedures, or [] when it has no price list. */
    procedures: readonly PromptProcedure[];
    clinicId: string;
  },
  opts: { run?: JsonPromptRunner } = {},
): Promise<ChatClassification | null> {
  if (!worthClassifying(args.text)) return null;
  const run = opts.run ?? runJsonPrompt;

  try {
    const { data } = await run<unknown>({
      system: buildClassifierPrompt({ today: args.today, procedures: args.procedures }),
      user: args.text,
      // A classification is four short fields. Capping this bounds the cost of a
      // model that decides to explain itself despite being told not to.
      maxTokens: 200,
      model: CHAT_MODEL,
    });
    return parseClassification(data, args.procedures.map((p) => p.id));
  } catch (e) {
    // Reported, not swallowed silently — but never rethrown. The patient's message
    // still reaches the front desk, which is what would have happened anyway.
    // NOTE: the message text is deliberately NOT included. It is a patient talking
    // about their own health (§10).
    report(e, { op: "ai.classifyMessage", clinicId: args.clinicId });
    return null;
  }
}
