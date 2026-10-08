"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { deliverContactEnquiry } from "@/core/notifications/contact-enquiry";
import { contactByIp, retryAfterLabel } from "@/core/security/rate-limit";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { isProduction } from "@/core/lib/env";
import { reportEvent } from "@/core/observability";

export type ContactFormState = { ok?: true; error?: string } | null;

/**
 * Faster than any person fills five fields. A bot posts the moment the page loads; a
 * human takes well over this just to read the labels.
 */
const MIN_FILL_MS = 3_000;
/** A tab left open for a day still works; an ancient replayed value does not. */
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional();

const enquirySchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(100),
  email: z.string().trim().max(200).pipe(z.email("Please enter a valid email address.")),
  phone: optional(30),
  subject: z.string().trim().min(3, "Please add a subject.").max(150),
  message: z
    .string()
    .trim()
    .min(10, "Please write a little more so we know how to help.")
    .max(5000, "Please keep the message under 5,000 characters."),
});

export async function submitContactForm(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  // Spam traps. In production both answer with a FAKE success: telling a bot which
  // check caught it teaches the next version to step around it.
  //  - `hp_x7` is a field hidden from people and screen readers; only a bot that fills
  //    every input it finds puts anything in it. Deliberately a meaningless name — it
  //    was `website`, and browser autofill / password managers filled that silently,
  //    so a REAL visitor was thanked while their message was thrown away.
  //  - `started` is stamped by the browser when the form mounts, so a post that comes
  //    back faster than a person could type — or with no stamp at all, i.e. a script
  //    posting straight at the endpoint — is not a person.
  const trap =
    String(formData.get("hp_x7") ?? "").trim() !== ""
      ? "honeypot"
      : (() => {
          const started = Number(formData.get("started"));
          const elapsed = Date.now() - started;
          if (!Number.isFinite(started) || started <= 0) return "no-timestamp";
          if (elapsed < MIN_FILL_MS) return "too-fast";
          if (elapsed > MAX_FILL_MS) return "stale";
          return null;
        })();
  if (trap) {
    // Counted, never silent: a trap that starts catching people is otherwise
    // indistinguishable from a quiet week. The reason only — nothing the visitor typed.
    reportEvent("contact form submission discarded by spam trap", {
      op: "contact.spam_trap",
      severity: "warn",
      ids: { reason: trap },
    });
    // Off production the reason is shown, so whoever is testing can tell a trapped
    // send from a delivered one — the fake success made the two look identical.
    if (!isProduction) return { error: `[dev only] Discarded by spam check: ${trap}.` };
    return { ok: true };
  }

  const parsed = enquirySchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    subject: formData.get("subject") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Counted only once the message is valid, so a person fixing a typo in their email
  // is never the one who runs out of attempts. Honest here, unlike the traps: a real
  // visitor can hit it, and they need to know to use WhatsApp instead.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const gate = contactByIp.peek(`contact:ip:${ip}`);
  if (gate.blocked) {
    return {
      error: `You've sent several messages already. Please try again in ${retryAfterLabel(gate.retryAfterMs)}, or message us on WhatsApp.`,
    };
  }
  contactByIp.hit(`contact:ip:${ip}`);

  const sent = await deliverContactEnquiry(parsed.data);
  if (!sent.ok) {
    return {
      error:
        "We couldn't send your message just now. Please message us on WhatsApp or email us directly — both reach the same team.",
    };
  }
  return { ok: true };
}
