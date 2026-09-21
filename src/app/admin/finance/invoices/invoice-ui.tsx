"use client";

import { useActionState, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  issueClinicInvoiceAction,
  voidClinicInvoiceAction,
  restoreClinicInvoiceAction,
  type InvoiceActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DatePicker } from "@/core/ui/date-picker";
import { Toast, useActionToast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoiceClinic = { id: string; name: string; monthlyPrice: number };

/** Issue a subscription invoice to a clinic (sub_invoices:create). */
export function IssueInvoiceForm({ clinics }: { clinics: InvoiceClinic[] }) {
  const [clinicId, setClinicId] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Clearing the form is part of issuing the invoice, so it happens in the action
  // once the server has accepted it — not in an effect that watches for the save to
  // have happened and then re-renders to undo the fields. The fields are declared
  // ABOVE this on purpose: the closure only runs after a submit, so referencing them
  // from above worked, but it read as using a value before it exists and the linter
  // said so.
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    async (prev, fd) => {
      const res = await issueClinicInvoiceAction(prev, fd);
      if (res.saved) {
        setClinicId("");
        setAmount("");
        setStart("");
        setEnd("");
      }
      return res;
    },
    {},
  );

  useActionToast(state, { saved: "Invoice issued.", error: true });

  // Pre-fill the amount with the selected clinic's monthly price.
  function onPickClinic(id: string) {
    setClinicId(id);
    const c = clinics.find((x) => x.id === id);
    if (c && c.monthlyPrice > 0) setAmount(String(c.monthlyPrice));
  }

  const clinicOptions = clinics.map((c) => ({ value: c.id, label: c.monthlyPrice > 0 ? `${c.name} (Rs ${c.monthlyPrice.toLocaleString("en-PK")}/mo)` : c.name }));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="periodStart" value={start} />
      <input type="hidden" name="periodEnd" value={end} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchableSelect
          label="Clinic"
          ariaLabel="Clinic to invoice"
          value={clinicId}
          onChange={onPickClinic}
          options={clinicOptions}
          placeholder="Pick a clinic"
          searchPlaceholder="Search clinics…"
          className="h-8 w-full"
        />
        <div className="space-y-1">
          <Label htmlFor="inv-amount" className="text-xs text-muted-foreground">Amount (Rs)</Label>
          <input
            id="inv-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className={inputCls}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-start" className="text-xs text-muted-foreground">Period start</Label>
          <DatePicker id="inv-start" ariaLabel="Period start" value={start} onChange={setStart} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-end" className="text-xs text-muted-foreground">Period end</Label>
          <DatePicker id="inv-end" ariaLabel="Period end" value={end} onChange={setEnd} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="inv-note" className="text-xs text-muted-foreground">Note</Label>
          <Input id="inv-note" name="note" className="h-8" placeholder="e.g. July 2026 subscription" />
        </div>
      </div>
      <Button type="submit" disabled={pending || !clinicId}>{pending ? "Issuing…" : "Issue invoice"}</Button>
    </form>
  );
}

/** Void (soft) or restore an invoice row. */
export function InvoiceRowActions({ id, deleted }: { id: string; deleted: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = (fn: () => Promise<InvoiceActionState>) =>
    start(async () => {
      const r = await fn();
      if (r.error) {
        setErr(r.error);
        setNonce((n) => n + 1);
      }
    });
  return (
    <>
      {deleted ? (
        <Button type="button" disabled={pending} onClick={() => run(() => restoreClinicInvoiceAction(id))} size="sm" variant="outline">
          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
        </Button>
      ) : (
        <Button type="button" disabled={pending} onClick={() => run(() => voidClinicInvoiceAction(id))} size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="size-3.5" aria-hidden="true" /> Void
        </Button>
      )}
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}
