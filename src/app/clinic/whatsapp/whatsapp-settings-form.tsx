"use client";

import { useActionState, useEffect, useState } from "react";
import { updateWhatsappSettings } from "@/app/clinic/actions";
import type { ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

/**
 * Clinic WhatsApp message personalization — the signature/footer and the per-event
 * custom notes fed into the approved templates' {{signature}} / {{note}} variables.
 * The clinic customises these values; the message layout is a WhatsApp-approved
 * template (see docs/whatsapp-cloud-plan.md). The sending NUMBER is set by the
 * super admin, not here.
 */
export function WhatsappSettingsForm({
  displayNumber,
  signature,
  notes,
}: {
  displayNumber: string | null;
  signature: string | null;
  notes: { booking?: string; reminder?: string; recall?: string } | null;
}) {
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    updateWhatsappSettings,
    {},
  );
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Personalize your WhatsApp messages. These fill the{" "}
        <span className="font-medium">signature</span> and{" "}
        <span className="font-medium">note</span> of your approved templates — the
        message layout itself is fixed by WhatsApp.
        {displayNumber ? (
          <>
            {" "}
            Sending from <span className="font-medium">{displayNumber}</span>.
          </>
        ) : (
          <> Your clinic&apos;s WhatsApp number isn&apos;t set up yet.</>
        )}
      </p>

      <div className="space-y-2">
        <Label htmlFor="signature">Signature / footer</Label>
        <Input
          id="signature"
          name="signature"
          defaultValue={signature ?? ""}
          maxLength={200}
          placeholder="e.g. — Smile Dental, Gulberg. Call 042-000000"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="noteBooking">Booking note</Label>
          <Input
            id="noteBooking"
            name="noteBooking"
            defaultValue={notes?.booking ?? ""}
            maxLength={300}
            placeholder="Added to booking confirmations"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="noteReminder">Reminder note</Label>
          <Input
            id="noteReminder"
            name="noteReminder"
            defaultValue={notes?.reminder ?? ""}
            maxLength={300}
            placeholder="Added to day-before reminders"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="noteRecall">Recall note</Label>
          <Input
            id="noteRecall"
            name="noteRecall"
            defaultValue={notes?.recall ?? ""}
            maxLength={300}
            placeholder="Added to recall reminders"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save personalization"}
      </Button>
      <Toast
        message={state.saved ? "WhatsApp settings saved." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}
