"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Field } from "@/core/ui/field";
import { Input } from "@/core/ui/input";
import { Textarea } from "@/core/ui/textarea";
import { submitContactForm, type ContactFormState } from "./actions";

/**
 * The enquiry form. Delivery is by email only (`deliverContactEnquiry`), so the action
 * answers honestly when it cannot send and this shows that answer rather than a
 * cheerful "thanks" over a message that went nowhere.
 */
export function ContactForm() {
  const [state, action, pending] = useActionState<ContactFormState, FormData>(submitContactForm, null);
  // Stamped on mount, not at render: the page is prerendered, so a render-time value
  // would be the BUILD time and every submission would look days old to the time trap.
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Submitted by hand rather than through `<form action>`: React RESETS a form once
  // its action settles, so a visitor who mistyped their email would lose the whole
  // message they had just written. The start time is attached here for the same
  // reason — a hidden input would be reset too, and the retry would then trip the
  // time trap and be silently discarded.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("started", String(startedAt.current));
    startTransition(() => action(fd));
  }

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-teal/12 text-primary-text">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>
        <h3 className="mk-h3">Message sent</h3>
        <p className="max-w-sm text-muted-foreground">
          Thank you — it is with our team now, and we will reply to the email address you gave us.
        </p>
      </div>
    );
  }

  return (
    // Autofill is off for the whole form, at the owner's direction: a browser that fills
    // fields on its own can also fill the hidden spam trap, and a visitor caught that way
    // is thanked while their message is discarded. Typing five short fields is a smaller
    // cost than a lost enquiry.
    <form onSubmit={onSubmit} autoComplete="off" className="relative grid gap-5 sm:grid-cols-2">
      {/* Honeypot. Off-screen rather than display:none (some bots skip hidden inputs),
          and out of the tab order and the accessibility tree so no person reaches it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-hp">Leave this empty</label>
        {/* A name no autofill heuristic recognises — `website` got filled by browsers. */}
        <input id="contact-hp" type="text" name="hp_x7" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" />
      </div>

      <Field label="Your name" required>
        <Input name="name" autoComplete="off" required minLength={2} maxLength={100} />
      </Field>
      <Field label="Email" required>
        <Input name="email" type="email" autoComplete="off" required maxLength={200} />
      </Field>
      <Field label="Phone" hint="Optional — WhatsApp works best." className="sm:col-span-2">
        <Input name="phone" type="tel" autoComplete="off" maxLength={30} />
      </Field>
      <Field label="Subject" required className="sm:col-span-2">
        <Input name="subject" autoComplete="off" required minLength={3} maxLength={150} placeholder="e.g. A demo for our clinic" />
      </Field>
      <Field label="Message" htmlFor="contact-message" required className="sm:col-span-2">
        <Textarea
          id="contact-message"
          name="message"
          autoComplete="off"
          rows={6}
          required
          minLength={10}
          maxLength={5000}
          placeholder="Tell us a little about your practice and what you would like to see."
        />
      </Field>

      {state?.error ? (
        <p role="alert" className="text-sm font-medium text-destructive-text sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
