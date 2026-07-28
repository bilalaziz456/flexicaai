"use client";

import { useActionState, useState } from "react";
import { updateClinicContact, type AdminActionState } from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

/** Curated timezones for the Pakistan + GCC rollout (see the deploy caveat). */
const TIMEZONES = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Kuwait",
  "Asia/Muscat",
  "Asia/Kolkata",
  "UTC",
];
const REGIONS = ["Pakistan", "GCC", "Other"];

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);

export type ClinicContact = {
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  region: string | null;
  timezone: string;
  notes: string | null;
};

/**
 * Super-admin "Owner & contact" editor (Feature 4). Persists owner/contact/region/
 * timezone/internal-notes via `updateClinicContact`. super-admin-gated server-side.
 */
export function ClinicContactForm({
  clinicId,
  contact,
}: {
  clinicId: string;
  contact: ClinicContact;
}) {
  const action = updateClinicContact.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    action,
    {},
  );
  // Controlled text fields — avoids Base UI's uncontrolled-FieldControl warning
  // when the form re-renders after a save.
  const [f, setF] = useState({
    ownerName: contact.ownerName ?? "",
    ownerPhone: contact.ownerPhone ?? "",
    ownerEmail: contact.ownerEmail ?? "",
    city: contact.city ?? "",
    country: contact.country ?? "",
  });
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form action={formAction} className="space-y-4">
      {state.saved ? <Toast message="Owner & contact saved." /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ownerName">Owner name</Label>
          <Input id="ownerName" name="ownerName" value={f.ownerName} onChange={on("ownerName")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ownerPhone">Owner phone</Label>
          <Input id="ownerPhone" name="ownerPhone" value={f.ownerPhone} onChange={on("ownerPhone")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ownerEmail">Owner email</Label>
          <Input id="ownerEmail" name="ownerEmail" type="email" value={f.ownerEmail} onChange={on("ownerEmail")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" value={f.city} onChange={on("city")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" value={f.country} onChange={on("country")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="region">Data region</Label>
          <select id="region" name="region" defaultValue={contact.region ?? ""} className={selectClass}>
            <option value="">—</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            name="timezone"
            defaultValue={contact.timezone || "Asia/Karachi"}
            className={selectClass}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <textarea
          id="address"
          name="address"
          rows={2}
          defaultValue={contact.address ?? ""}
          className={cn(selectClass, "h-auto py-1.5")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Internal notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Private notes about this clinic (not shown to the clinic)."
          defaultValue={contact.notes ?? ""}
          className={cn(selectClass, "h-auto py-1.5")}
        />
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save owner & contact"}
      </Button>
    </form>
  );
}
