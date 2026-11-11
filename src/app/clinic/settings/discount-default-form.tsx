"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "@/core/ui/action-form";
import { Button } from "@/core/ui/button";
import { useActionToast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import type { DiscountDefaultBearer } from "@/core/clinics/discount-default";
import { setClinicDiscountDefault, type SettingsActionState } from "./actions";

const OPTIONS: { value: DiscountDefaultBearer; label: string; hint: string }[] = [
  { value: "clinic", label: "Clinic", hint: "Comes out of the clinic's share" },
  { value: "doctor", label: "Doctor", hint: "Comes out of the doctor's share" },
  { value: "split", label: "Split", hint: "By the doctor's share" },
];

/**
 * Who bears a new discount by default (owner, 2026-11-11). Every discount box —
 * booking, invoice, consultation, each line, a treatment plan — opens on this, and
 * staff can still change it on any one discount.
 */
export function DiscountDefaultForm({ value }: { value: DiscountDefaultBearer }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(setClinicDiscountDefault, {});
  useActionToast(state, { saved: "Saved." });
  const [borneBy, setBorneBy] = useState<DiscountDefaultBearer>(value);

  return (
    <ActionForm action={action} state={state} className="space-y-4">
      <input type="hidden" name="borneBy" value={borneBy} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Discount borne by</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Discount borne by default">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={borneBy === o.value}
              onClick={() => setBorneBy(o.value)}
              className={cn(
                "flex min-w-36 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                borneBy === o.value ? "border-primary bg-primary/10" : "hover:bg-accent",
              )}
            >
              <span className="text-sm font-medium">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {borneBy === "split" ? (
        <p className="max-w-prose rounded-lg border well px-3 py-2 text-sm">
          The doctor bears the same part of a discount as their share of what was
          discounted: a doctor on a 20% share bears 20% of the discount, on 40% bears 40%,
          and on 0% bears nothing. The clinic bears the rest. The part is filled in from each
          doctor&apos;s shares, procedure by procedure, and staff can still type another.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        A new discount starts on this; staff can still pick Clinic, Doctor or Split on any
        discount. A discount the doctor bears still waits for the doctor&apos;s approval.
        Discounts already given are not changed.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || borneBy === value}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
    </ActionForm>
  );
}
