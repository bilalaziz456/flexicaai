"use client";

import { useActionState, useState } from "react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { useActionToast } from "@/core/ui/toast";
import { submitCashCount, submitCashTransfer, type CashActionState } from "./cash-actions";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * The handover count.
 *
 * The expected figure is shown BEFORE the box is counted, which is a deliberate
 * choice and the one most worth arguing about: it lets somebody type the expected
 * number instead of counting. Hiding it is worse — a person who cannot see it cannot
 * catch an obvious data-entry error either, and the honest ways to detect a lazy
 * count (denominations, a second signature) are not built yet. It is recorded who
 * counted and when, which is what makes the number answerable for.
 */
export function CountForm({ expected }: { expected: number | null }) {
  const [counted, setCounted] = useState("");
  // Clearing the field is part of recording the count, so it happens in the action.
  // The input is CONTROLLED, so React's own post-action form reset does not touch it
  // — it kept the number that had just been submitted, and the live variance line
  // then read "Balances exactly" against a count that was already history.
  const [state, formAction, pending] = useActionState<CashActionState, FormData>(
    async (prev, fd) => {
      const res = await submitCashCount(prev, fd);
      if (res.saved) setCounted("");
      return res;
    },
    {},
  );
  useActionToast(state, {
    saved: expected === null ? "Opening float recorded." : "Count recorded.",
    error: true,
  });
  // Live, while they type — the point of a count is the gap, and making somebody
  // submit to see it turns a typo into a signed-off variance.
  const n = counted.trim() === "" ? null : Number(counted);
  const variance = expected !== null && n !== null && Number.isFinite(n) ? n - expected : null;

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="countedTotal">
          {expected === null ? "What is in the drawer now?" : "Counted total"}
        </Label>
        <Input
          id="countedTotal"
          name="countedTotal"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="0"
        />
        {variance !== null ? (
          <p
            className={
              variance === 0
                ? "text-xs text-success-text"
                : variance < 0
                  ? "text-xs text-destructive"
                  : "text-xs text-warning-text"
            }
          >
            {variance === 0
              ? "Balances exactly."
              : variance < 0
                ? `${rs(Math.abs(variance))} short of what the ledgers expect.`
                : `${rs(variance)} more than the ledgers expect.`}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="count-note">Note {variance !== null && variance !== 0 ? "" : "(optional)"}</Label>
        <Input
          id="count-note"
          name="note"
          placeholder={
            variance !== null && variance !== 0
              ? "What explains the difference?"
              : "Anything worth recording"
          }
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : expected === null ? "Record opening float" : "Record count"}
      </Button>
    </form>
  );
}

/** Cash into or out of the drawer that is not a cost — banking, a draw, a top-up. */
export function TransferForm() {
  const [state, formAction, pending] = useActionState<CashActionState, FormData>(
    submitCashTransfer,
    {},
  );
  useActionToast(state, { saved: "Recorded.", error: true });
  const [kind, setKind] = useState("bank_deposit");

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="space-y-1.5">
        <Label htmlFor="xfer-kind">What happened</Label>
        <SelectField
          value={kind}
          onValueChange={setKind}
          ariaLabel="What happened"
          className="w-full"
          options={[
            { value: "bank_deposit", label: "Banked the takings" },
            { value: "owner_draw", label: "Taken by the owner" },
            { value: "float_topup", label: "Cash added to the float" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="xfer-amount">Amount (Rs)</Label>
        <Input id="xfer-amount" name="amount" type="number" inputMode="numeric" min={1} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="xfer-ref">Reference (optional)</Label>
        <Input id="xfer-ref" name="reference" placeholder="Deposit slip no." />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Recording…" : "Record"}
      </Button>
    </form>
  );
}
