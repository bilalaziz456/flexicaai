import { z } from "zod";
import { CHAT_INTENT_CODES, type ChatIntentCode } from "@/core/db/vocabulary-seed";

/**
 * What the model is allowed to say — CORE, specialty-agnostic.
 *
 * This file is the boundary. Everything the model returns passes through it, and
 * anything that does not fit is rejected whole rather than partially trusted. The
 * model produces NO free text, NO numbers, and NO identifiers of its own: a price
 * comes from a row, a date is re-parsed by `parseWhen` after the patient confirms it,
 * and `procedureId` must be one of the ids handed to the prompt.
 *
 * See docs/whatsapp-ai-plan.md for why the classification is all it is trusted with.
 */

/**
 * `clinical` is a FIRST-CLASS outcome, not a fall-through into `other`.
 *
 * It routes to a human exactly as `other` does, so today they behave identically —
 * which is the point at which it would be tempting to merge them. Keeping them apart
 * buys two things: the staff queue can flag a clinical question rather than bury it
 * among booking requests, and Phase 6 records the classification, so there is
 * eventually DATA on how often patients ask clinical questions. That number is what
 * decides whether triage is ever worth building. Merged, it is unknowable.
 */
export const CHAT_INTENTS = CHAT_INTENT_CODES;

export type ChatIntent = ChatIntentCode;

/**
 * The RAW model output. Dates and times arrive as plain strings and their FORMAT is
 * checked during narrowing, not here, on purpose: a malformed date should drop the
 * date, not the whole classification. The intent is an enum the model picked from a
 * closed list — a formatting slip in one field says nothing about it, and "book, no
 * date" is still useful (the handler asks the patient for one). Rejecting the lot
 * would send a perfectly good booking request to the front desk instead.
 */
const rawSchema = z.object({
  intent: z.enum(CHAT_INTENTS),
  date: z.string().nullish(),
  time: z.string().nullish(),
  procedureId: z.string().nullish(),
  doctorIds: z.array(z.string()).nullish(),
});

export type ChatClassification = {
  intent: ChatIntent;
  date: { y: number; m: number; d: number } | null;
  time: { h: number; min: number } | null;
  /** Always one of the ids given to the prompt, or null. Never a name, never a price. */
  procedureId: string | null;
  /**
   * Doctors the patient named, for a consultation-fee question. A LIST, not one id:
   * "what do Dr Bilal and Dr Umer charge?" is one question about two people, and
   * answering half of it reads as though only half was heard.
   */
  doctorIds: string[];
};

/**
 * Narrow one model response, or return null.
 *
 * `allowedProcedureIds` is not advisory. A model asked to pick from a list will
 * occasionally return something adjacent — a name, a truncated id, an id from an
 * earlier example — and a price quoted against an id we did not offer is a figure
 * from nowhere. An unrecognised id drops the whole `price` intent to `other`, which
 * sends the patient to a human rather than to a guess.
 */
export function parseClassification(
  value: unknown,
  allowedProcedureIds: readonly string[],
  allowedDoctorIds: readonly string[] = [],
): ChatClassification | null {
  const parsed = rawSchema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data;

  const date = (() => {
    if (!r.date || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date)) return null;
    const [y, m, d] = r.date.split("-").map(Number);
    // A model can emit a well-formed string for a day that does not exist. Reject
    // rather than let `new Date` roll 31 Feb forward into March.
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
  })();

  const time = (() => {
    if (!r.time || !/^[0-9]{1,2}:[0-9]{2}$/.test(r.time)) return null;
    const [h, min] = r.time.split(":").map(Number);
    if (h > 23 || min > 59) return null;
    return { h, min };
  })();

  const procedureId =
    r.procedureId && allowedProcedureIds.includes(r.procedureId) ? r.procedureId : null;

  // Same closed-set rule as procedures, and for the same reason: a fee quoted against
  // a doctor we did not offer is a figure from nowhere. Unknown ids are dropped, and
  // duplicates collapsed so "Dr Bilal and Dr Bilal" is answered once.
  const namedAnyone = (r.doctorIds ?? []).length > 0;
  const doctorIds = [...new Set((r.doctorIds ?? []).filter((id) => allowedDoctorIds.includes(id)))];

  // TWO DIFFERENT EMPTY CASES, and collapsing them would be wrong in opposite
  // directions:
  //   • named NOBODY ("how much do you charge?") — a general question, answerable by
  //     listing the clinic's doctors. Stays `fee`.
  //   • named someone we do NOT have ("what does Dr Smith charge?") — replying with a
  //     list of other doctors does not answer that, and pretending it does is worse
  //     than silence. Becomes `other`, and a person handles it.
  const feeUnanswerable = r.intent === "fee" && namedAnyone && doctorIds.length === 0;

  // A price question we cannot tie to a real procedure is not one we can answer.
  const intent: ChatIntent =
    (r.intent === "price" && !procedureId) || feeUnanswerable ? "other" : r.intent;

  return { intent, date, time, procedureId, doctorIds };
}
