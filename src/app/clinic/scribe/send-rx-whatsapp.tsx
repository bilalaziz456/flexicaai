"use client";

import { useState, useTransition } from "react";
import { Check, MessageCircle } from "lucide-react";
import { Button } from "@/core/ui/button";
import { sendPrescriptionToWhatsApp } from "@/app/clinic/scribe/actions";

/** Sends the visit's prescription to the patient on WhatsApp (approved visits). */
export function SendRxWhatsApp({ visitId }: { visitId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await sendPrescriptionToWhatsApp(visitId);
      if ("error" in r) {
        setState("error");
        setError(r.error);
      } else {
        setState("sent");
      }
    });
  }

  if (state === "sent") {
    // Stays the size of the button it replaces, so the row does not reflow the moment
    // the send lands — the one time the reader is looking straight at it.
    return (
      <span className="inline-flex h-8 items-center gap-1 px-2 text-xs font-medium text-success-text">
        <Check className="size-3.5" aria-hidden="true" />
        Sent
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={send}
      disabled={pending}
      title={error ?? "Send to patient on WhatsApp"}
    >
      <MessageCircle aria-hidden="true" />
      {pending ? "Sending…" : state === "error" ? "Retry" : "WhatsApp"}
    </Button>
  );
}
