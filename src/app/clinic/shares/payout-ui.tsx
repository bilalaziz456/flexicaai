"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
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

/**
 * Record a payout settling a doctor's outstanding shares for the CURRENT filter
 * period. Shown to a clinic admin when the report is scoped to one doctor with a
 * positive outstanding balance. The hidden period fields mirror the report filter.
 */
export function RecordPayoutForm({
  doctorId,
  outstanding,
  period,
  from,
  to,
}: {
  doctorId: string;
  outstanding: number;
  period: string;
  from: string;
  to: string;
}) {
  const [state, formAction, pending] = useActionState<PayoutActionState, FormData>(
    recordDoctorPayout,
    {},
  );
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <input
        type="text"
        name="note"
        placeholder="Reference / note (optional)"
        className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button type="submit" disabled={pending || outstanding <= 0}>
        {pending ? "Recording…" : `Record payout of ${money.format(outstanding)}`}
      </Button>
      <Toast
        message={state.saved ? "Payout recorded." : state.error ?? null}
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
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        <Undo2 className="size-3" aria-hidden="true" /> Reverse
      </button>
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}
