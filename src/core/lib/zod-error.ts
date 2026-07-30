import type { ZodError } from "zod";

/**
 * Human-readable summary of a zod validation failure — CORE. Joins ALL issue messages
 * (deduped) with " · ", so a multi-field form surfaces every problem at once instead of
 * only the first (the user fixes them in one pass, not one submit at a time). Replaces
 * the repeated `error.issues[0]?.message ?? "Invalid input."` pattern in server actions.
 */
export function zodErrorMessage(error: ZodError, fallback = "Invalid input."): string {
  const seen = new Set<string>();
  const msgs: string[] = [];
  for (const issue of error.issues) {
    const m = issue.message?.trim();
    if (m && !seen.has(m)) {
      seen.add(m);
      msgs.push(m);
    }
  }
  return msgs.length ? msgs.join(" · ") : fallback;
}
