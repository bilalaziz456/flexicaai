"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { sendPrescriptionToWhatsApp } from "./actions";

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
    return <span className="text-xs text-emerald-600">Sent ✓</span>;
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={pending}
      title={error ?? "Send to patient on WhatsApp"}
      className="inline-flex items-center gap-1 text-primary underline underline-offset-4 disabled:opacity-50"
    >
      <MessageCircle className="size-3.5" aria-hidden="true" />
      {pending ? "Sending…" : state === "error" ? "Retry" : "WhatsApp"}
    </button>
  );
}
