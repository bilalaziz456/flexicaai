"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Printer, Undo2 } from "lucide-react";
import {
  recordDoctorPayout,
  voidDoctorPayout,
  type PayoutActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Record a payment of an ARBITRARY amount against a doctor's outstanding balance
 * (partial allowed). Shown to a clinic admin when scoped to one doctor with a
 * positive balance. The amount defaults to the full outstanding but can be reduced.
 */
export function RecordPayoutForm({
  doctorId,
  outstanding,
}: {
  doctorId: string;
  outstanding: number;
}) {
  const [state, formAction, pending] = useActionState<PayoutActionState, FormData>(
    recordDoctorPayout,
    {},
  );
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);
  const [amount, setAmount] = useState(String(outstanding));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="doctorId" value={doctorId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="pay-amount">
            Amount (Rs) — outstanding {money.format(outstanding)}
          </label>
          <input
            id="pay-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={outstanding}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="pay-method">
            Method
          </label>
          <select
            id="pay-method"
            name="method"
            defaultValue="cash"
            className={`${inputCls} select-chevron pr-8`}
          >
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="pay-ref">
            Reference (optional)
          </label>
          <input id="pay-ref" name="reference" type="text" placeholder="Txn / cheque no." className={inputCls} />
        </div>
      </div>
      <input type="text" name="note" aria-label="Note for this payout" placeholder="Note (optional)" className={inputCls} />
      <Button
        type="submit"
        disabled={pending || outstanding <= 0 || Number(amount) <= 0}
      >
        {pending ? "Recording…" : "Record payment"}
      </Button>
      <Toast
        message={state.saved ? "Payment recorded." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}

/** Reverse a payout (returns its shares to outstanding). Clinic-admin only. */
export function VoidPayoutButton({ payoutId }: { payoutId: string }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await voidDoctorPayout(payoutId);
            if (r.error) {
              setErr(r.error);
              setNonce((n) => n + 1);
            }
          })
        }
        className="inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        <Undo2 className="size-3" aria-hidden="true" /> Reverse
      </button>
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}

/** Triggers the browser's print dialog (hidden itself when printing). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" /> Print / Save PDF
    </Button>
  );
}
