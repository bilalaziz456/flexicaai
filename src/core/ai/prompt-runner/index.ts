import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/core/lib/env";

/**
 * Generic prompt runner — CORE. Runs a system prompt + user text through Claude
 * and returns parsed JSON. It knows nothing about dental/derma; callers supply
 * the specialty prompt (CLAUDE.md §8). Kept tiny and provider-specific on
 * purpose: the ONE place the Anthropic SDK is used for structured generation.
 */

// Scribe model — quality matters (CLAUDE.md §8). Sonnet 4.6 does not support
// output_config.format structured outputs, so we constrain via the prompt and
// parse defensively below.
const SCRIBE_MODEL = "claude-sonnet-4-6";

export class MissingApiKeyError extends Error {}
export class AiParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!serverEnv.ANTHROPIC_API_KEY) {
    throw new MissingApiKeyError(
      "ANTHROPIC_API_KEY is not set — add it to .env.local to use the AI scribe.",
    );
  }
  client ??= new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Extract the first balanced JSON object from a string. The prompt asks for
 * pure JSON, but models occasionally wrap it in prose or code fences — this
 * recovers the object instead of failing outright.
 */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new AiParseError("No JSON object in model output", text);
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new AiParseError("Unbalanced JSON in model output", text);
}

/**
 * Run a JSON prompt and return the parsed object plus the raw model text (kept
 * for the accuracy flywheel — CLAUDE.md §8).
 */
/** Token usage of a Claude call — for precise cost metering (core/ai/usage.ts). */
export type ClaudeUsage = { model: string; inputTokens: number; outputTokens: number };

export async function runJsonPrompt<T = Record<string, unknown>>(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ data: T; raw: string; usage: ClaudeUsage }> {
  const message = await getClient().messages.create({
    model: SCRIBE_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const usage: ClaudeUsage = {
    model: message.model ?? SCRIBE_MODEL,
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };

  let data: T;
  try {
    data = JSON.parse(extractJson(raw)) as T;
  } catch (e) {
    if (e instanceof AiParseError) throw e;
    throw new AiParseError("Model returned malformed JSON", raw);
  }
  return { data, raw, usage };
}
