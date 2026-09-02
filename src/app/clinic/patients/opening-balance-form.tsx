"use client";

import { useActionState } from "react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { recordOpeningPayment } from "@/app/clinic/payments/payment-actions";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";

/**
 * Record a payment against a patient's imported OPENING balance. `owed` caps the
 * amount; on success the page revalidates (owed drops) and the form key remounts to
 * clear. Gated upstream by billing:create.
 */
export function OpeningBalanceForm({ patientId, owed }: { patientId: string; owed: number }) {
  // Methods come from the database (ADR-027): active only, in its own order.
  const methodOptions = useTenderOptions();
  const [state, action, pending] = useActionState(recordOpeningPayment.bind(null, patientId), {} as { error?: string; saved?: boolean });

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Amount (up to Rs {owed.toLocaleString("en-PK")})</span>
        <Input name="amount" type="number" min={1} max={owed} step={1} required className="w-36" placeholder="0" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Method</span>
        <select
          name="method"
          className="h-9 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring select-chevron"
        >
          {methodOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Reference (optional)</span>
        <Input name="reference" className="w-40" placeholder="Txn / cheque no." />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </Button>
      {state.error ? <p className="w-full text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
