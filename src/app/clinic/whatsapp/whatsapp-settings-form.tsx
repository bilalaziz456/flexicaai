"use client";

import { useActionState, useState } from "react";
import { updateWhatsappSettings } from "@/app/clinic/actions";
import type { ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { useActionToast } from "@/core/ui/toast";

/**
 * Clinic WhatsApp message personalization — the signature/footer fed into the
 * approved templates' {{signature}} variable. The clinic customises this value; the
 * message layout is a WhatsApp-approved template (see docs/whatsapp-cloud-plan.md).
 * The sending NUMBER is set by the super admin, not here.
 */
export function WhatsappSettingsForm({
  displayNumber,
  signature: initialSignature,
}: {
  displayNumber: string | null;
  signature: string | null;
}) {
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    updateWhatsappSettings,
    {},
  );
  useActionToast(state, { saved: "WhatsApp signature saved.", error: true });

  // Controlled so a post-save revalidation (which changes the prop) doesn't trip
  // Base UI's "changing uncontrolled default" warning.
  const [signature, setSignature] = useState(initialSignature ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add a signature that appears at the end of every WhatsApp message the clinic
        sends. The message layout itself is a WhatsApp-approved template.
        {displayNumber ? (
          <>
            {" "}
            Sending from <span className="font-medium">{displayNumber}</span>.
          </>
        ) : (
          <>
            {" "}
            You can set this now. It takes effect once your clinic&apos;s own WhatsApp
            number is activated.
          </>
        )}
      </p>

      <div className="space-y-2">
        <Label htmlFor="signature">Signature / footer</Label>
        <Input
          id="signature"
          name="signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          maxLength={200}
          placeholder="e.g. Smile Dental, Gulberg. Call 042-000000"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save signature"}
      </Button>
    </form>
  );
}
