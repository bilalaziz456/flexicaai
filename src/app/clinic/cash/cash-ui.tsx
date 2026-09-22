"use client";

import { useActionState, useState } from "react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { useActionToast } from "@/core/ui/toast";
import { useVocabularyOptions } from "@/core/ui/vocabulary-provider";
import {
  submitCashCount,
  submitCashSpend,
  submitCashTransfer,
  type CashActionState,
} from "./cash-actions";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/** Not a transfer kind — a marker for the option that writes an EXPENSE instead. */
const SPEND = "__spend__";

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

/**
 * Cash leaving or entering the drawer.
 *
 * THE OPTIONS ARE NOT ALL THE SAME KIND OF THING, and the split is deliberate. Three
 * of them are TRANSFERS — banking the takings, an owner draw, a float top-up — money
 * moving between the clinic's own pockets, which buys nothing and so never touches
 * the P&L. "Paid for something" is a COST, and it is routed to the expenses ledger
 * instead: recorded as a transfer it would leave the drawer correctly and understate
 * the clinic's expenses by exactly that amount, every time, without a symptom.
 *
 * They share a control because to the person at the desk it is one question — cash
 * left the box, why? — and making them pick the right ledger first would be asking
 * them to know the bookkeeping before they can record the fact.
 */
export function TransferForm({ canSpend }: { canSpend: boolean }) {
  const [state, formAction, pending] = useActionState<CashActionState, FormData>(
    submitCashTransfer,
    {},
  );
  const [spendState, spendAction, spendPending] = useActionState<CashActionState, FormData>(
    submitCashSpend,
    {},
  );
  useActionToast(state, { saved: "Recorded.", error: true });
  useActionToast(spendState, { saved: "Expense recorded.", error: true });
  // The LABELS COME FROM THE DATABASE (ADR-027), not from this component. They were
  // written out here — "Banked the takings", "Taken by the owner" — which is a second
  // copy of a vocabulary the database already owns, and it had already drifted from
  // the rows it was meant to mirror. Renaming one is a row update, and this is how it
  // reaches the screen. It also means a kind retired with `is_active = false` stops
  // being offered without touching this file.
  const kinds = useVocabularyOptions("cash_transfer_kinds");
  // Appended, not seeded into the vocabulary: it is not a transfer kind and must
  // never become a row in that table, or somebody will read the three and the fourth
  // as the same sort of thing. Offered only to whoever may record an expense —
  // `expenses:create`, which the front desk does not hold by default.
  const options = canSpend ? [...kinds, { value: SPEND, label: "Paid for something" }] : kinds;
  const [kind, setKind] = useState(options[0]?.value ?? "bank_deposit");
  const spending = kind === SPEND;

  return (
    <form action={spending ? spendAction : formAction} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="space-y-1.5">
        {/* Not `htmlFor` — the trigger is a Base UI button with its own generated id,
            so a label pointing at "xfer-kind" pointed at nothing and clicking it did
            nothing. `ariaLabel` on the field is what a screen reader reads. */}
        <p className="text-sm font-medium">What happened</p>
        <SelectField
          value={kind}
          onValueChange={setKind}
          ariaLabel="What happened"
          className="w-full"
          options={options}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="xfer-amount">Amount (Rs)</Label>
        <Input id="xfer-amount" name="amount" type="number" inputMode="numeric" min={1} required />
      </div>
      {spending ? (
        <div className="space-y-1.5">
          <Label htmlFor="xfer-what">What for</Label>
          <Input id="xfer-what" name="what" required maxLength={120} placeholder="e.g. gloves, courier" />
          <p className="text-xs text-muted-foreground">
            Recorded as a cash expense, so it reaches the P&amp;L. Add a category later
            in Expenses if you want it grouped.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="xfer-ref">Reference (optional)</Label>
          <Input id="xfer-ref" name="reference" placeholder="Deposit slip no." />
        </div>
      )}
      <Button type="submit" variant="outline" disabled={pending || spendPending}>
        {pending || spendPending ? "Recording…" : "Record"}
      </Button>
    </form>
  );
}
