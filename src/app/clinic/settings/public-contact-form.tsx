"use client";

import { useActionState, useState } from "react";
import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { setClinicPublicContact, type SettingsActionState } from "./actions";

/**
 * The clinic's PUBLIC address and opening hours — what a patient is told when they
 * ask over WhatsApp. Saves `clinics.public_address` and `clinics.opening_hours`.
 *
 * Free text, both of them, because both are DISPLAY-ONLY. Opening hours in
 * particular are deliberately not a structured schedule: a weekday grid would look
 * like it drives something, and it does not — bookability is decided by each
 * doctor's own working hours, and nothing here can make a slot bookable or refuse
 * one. The helper text below says so, because a clinic admin who believes otherwise
 * will eventually wonder why setting "open Sunday" changed nothing.
 */
export function PublicContactForm({
  address,
  hours,
}: {
  address: string | null;
  hours: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    setClinicPublicContact,
    {},
  );
  const [a, setA] = useState(address ?? "");
  const [h, setH] = useState(hours ?? "");
  const unchanged = a === (address ?? "") && h === (hours ?? "");

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="publicAddress">Address</Label>
        <textarea
          id="publicAddress"
          name="publicAddress"
          value={a}
          onChange={(e) => setA(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="e.g. 12-C, Main Boulevard, Gulberg III, Lahore"
          className="w-full rounded-lg border border-input bg-[var(--input-bg)] px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Sent to a patient who asks where you are. Leave blank and we&apos;ll pass the
          question to your front desk instead.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="openingHours">Opening hours</Label>
        <input
          id="openingHours"
          name="openingHours"
          value={h}
          onChange={(e) => setH(e.target.value)}
          maxLength={200}
          placeholder="e.g. Mon–Sat 9:00 AM – 9:00 PM, closed Sunday"
          className="h-9 w-full rounded-lg border border-input bg-[var(--input-bg)] px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          When the clinic is open. This is shown to patients only — it does{" "}
          <span className="font-medium">not</span> decide when appointments can be
          booked. That comes from each doctor&apos;s own working hours, and a patient
          asking about timings is told both.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending || unchanged}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
      <Toast
        message={state.saved ? "Saved." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={state.saved ? 1 : 0}
      />
    </form>
  );
}
