import "server-only";

import { serverEnv } from "@/core/lib/env";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { classifyMessage, worthClassifying, type ChatIntent } from "@/core/ai/chat-engine";
import { formatWhen } from "@/core/appointments/parse-when";
import { listQuotableProcedures } from "@/core/procedures/quotable";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { chatIntentByClinic, chatIntentByPhone } from "@/core/security/rate-limit";
import { report } from "@/core/observability";

/**
 * The AI fallback for inbound WhatsApp — CORE. Runs ONLY after the deterministic
 * handlers have declined, and only for a clinic with the `whatsapp_ai` feature.
 *
 * WHAT IT IS ALLOWED TO DO: reply with the patient's own request restated in the
 * format `parseWhen` reads, or with a price from the clinic's own list. That is all.
 * It never books, moves or cancels anything — the patient sends the restated message
 * back, and the DETERMINISTIC handler acts on it. A misreading therefore costs one
 * confusing message rather than a wrongly-moved appointment.
 *
 * See docs/whatsapp-ai-plan.md. The ordering is the safety property: this file cannot
 * run before the parser, and cannot write.
 */

export type AssistantOutcome = {
  /** True when we replied. The message still reaches the queue either way. */
  replied: boolean;
  /** What the message was about, for the queue and for Phase 6's analytics. */
  intent: ChatIntent | null;
};

const NOTHING: AssistantOutcome = { replied: false, intent: null };

/** Today in the SERVER's timezone — the same clock availability and reminders read (D-14). */
function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The canonical restatement, on its own line so it is easy to copy on a phone.
 * `formatWhen` guarantees the parser reads back exactly what we print here
 * (`scripts/test-parse-when-roundtrip.ts`).
 */
function echoLine(verb: "book" | "reschedule", when: Date, now: Date): string {
  return `${verb} ${formatWhen(when, now)}`;
}

async function reply(
  args: { clinicId: string; patientId: string; phone: string },
  campaignName: string,
  message: string,
): Promise<boolean> {
  const r = await sendWhatsAppToPatient({ ...args, campaignName, templateParams: [message], body: message });
  return r.ok;
}

/**
 * Classify one inbound message and, if it is actionable, reply with the canonical
 * restatement. Returns whether we replied and what the message was about.
 *
 * NEVER THROWS. Every failure — feature off, rate limited, no key, provider error,
 * unusable output, a clinical question — returns without replying, and the message
 * continues to the staff queue exactly as it does today. That is the acceptance
 * criterion for this whole feature: no worse than not having it.
 */
export async function runAssistant(args: {
  clinicId: string;
  patientId: string;
  phone: string;
  text: string;
  now?: Date;
}): Promise<AssistantOutcome> {
  const now = args.now ?? new Date();
  try {
    if (!worthClassifying(args.text)) return NOTHING;

    const clinic = await getClinic(args.clinicId);
    if (!clinicHasFeature(clinic?.featuresEnabled, "whatsapp_ai")) return NOTHING;

    // Both bounds are checked BEFORE the paid call, and a throttled message simply
    // goes to a human — never an "you are sending too many messages" reply, which
    // would be a strange thing for a clinic to say to a patient in pain.
    if (chatIntentByPhone.hit(args.phone).blocked) return NOTHING;
    if (chatIntentByClinic.hit(args.clinicId).blocked) return NOTHING;

    // The price list is only offered to the model when the clinic has opted into
    // price replies. With no list, the prompt is told the price intent is unavailable,
    // so a price question becomes `other` and reaches a person.
    const procedures = clinicHasFeature(clinic?.featuresEnabled, "whatsapp_prices")
      ? await listQuotableProcedures(args.clinicId)
      : [];

    const c = await classifyMessage({
      text: args.text,
      today: todayIso(now),
      procedures,
      clinicId: args.clinicId,
    });
    if (!c) return NOTHING;

    // A clinical question is recognised, never answered. It reaches a human exactly
    // as `other` does — the value of naming it is that the queue can flag it, and
    // that Phase 6 can count how often it happens.
    if (c.intent === "clinical" || c.intent === "other") {
      return { replied: false, intent: c.intent };
    }

    if (c.intent === "price" && c.procedureId) {
      const proc = procedures.find((p) => p.id === c.procedureId);
      // `parseClassification` already rejected an id we did not offer, so this can
      // only be null if the list changed underneath us. Say nothing rather than guess.
      if (!proc) return { replied: false, intent: "other" };
      const replied = await reply(
        args,
        serverEnv.AISENSY_BOOKING_REPLY_CAMPAIGN,
        priceMessage(proc.name, proc.price),
      );
      return { replied, intent: "price" };
    }

    if (c.intent === "cancel") {
      // No date to restate — the deterministic handler cancels the patient's next
      // upcoming appointment, so the canonical form is the bare word.
      if (!clinicHasFeature(clinic?.featuresEnabled, "whatsapp_cancel")) {
        return { replied: false, intent: "cancel" };
      }
      const replied = await reply(
        args,
        serverEnv.AISENSY_RESCHEDULE_CAMPAIGN,
        `To cancel your appointment, reply with this message:\n\ncancel appointment`,
      );
      return { replied, intent: "cancel" };
    }

    const verb = c.intent === "book" ? "book" : "reschedule";
    const campaign =
      verb === "book" ? serverEnv.AISENSY_BOOKING_REPLY_CAMPAIGN : serverEnv.AISENSY_RESCHEDULE_CAMPAIGN;
    const what = verb === "book" ? "book" : "move your appointment";

    // Only restate a time the patient actually gave. Filling in a plausible one would
    // put a time in their mouth that they might send straight back.
    if (c.date && c.time) {
      const when = new Date(c.date.y, c.date.m - 1, c.date.d, c.time.h, c.time.min, 0, 0);
      if (when.getTime() <= now.getTime()) return { replied: false, intent: c.intent };
      const replied = await reply(
        args,
        campaign,
        `To ${what}, reply with this message:\n\n${echoLine(verb, when, now)}`,
      );
      return { replied, intent: c.intent };
    }

    // Intent understood, date or time missing. Today this message gets no reply at
    // all, so a worked EXAMPLE is strictly better — and it teaches the format, which
    // is what keeps the next message off this path entirely.
    const example = new Date(now);
    example.setDate(example.getDate() + 1);
    example.setHours(16, 0, 0, 0);
    const replied = await reply(
      args,
      campaign,
      `To ${what}, reply with the date and time, like this:\n\n${echoLine(verb, example, now)}`,
    );
    return { replied, intent: c.intent };
  } catch (e) {
    // The message still reaches the front desk; that is the whole fallback.
    report(e, { op: "whatsapp.assistant", clinicId: args.clinicId });
    return NOTHING;
  }
}

/**
 * The price sentence. Three constraints, none optional:
 *  - INDICATIVE, because a texted price is a commitment patients will hold you to;
 *  - it EXCLUDES the consultation fee, which lives on `users.consultation_fee` and is
 *    per DOCTOR — so a total genuinely cannot be quoted from a procedure row;
 *  - it says the final amount is confirmed at the visit.
 * It ends with the booking line, so a price question can become a booking.
 */
function priceMessage(name: string, price: number): string {
  const rs = new Intl.NumberFormat("en-PK").format(price);
  return (
    `${name}: from Rs ${rs} — indicative, and excludes consultation and anything ` +
    `else needed on the day. The final amount is confirmed at your visit.\n\n` +
    `To book, reply with the date and time, like this:\n\nbook 12 Jul 4:00pm`
  );
}
