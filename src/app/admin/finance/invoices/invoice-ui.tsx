"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
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
import { Toast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoiceClinic = { id: string; name: string; monthlyPrice: number };

/** Issue a subscription invoice to a clinic (sub_invoices:create). */
export function IssueInvoiceForm({ clinics }: { clinics: InvoiceClinic[] }) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(issueClinicInvoiceAction, {});
  const [nonce, setNonce] = useState(0);
  const [clinicId, setClinicId] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (state.saved) {
      setClinicId("");
      setAmount("");
      setStart("");
      setEnd("");
    }
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);

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
          className="w-full"
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
      <Toast message={state.saved ? "Invoice issued." : state.error ?? null} variant={state.error ? "error" : "success"} token={nonce} />
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
        <button type="button" disabled={pending} onClick={() => run(() => restoreClinicInvoiceAction(id))} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50">
          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => run(() => voidClinicInvoiceAction(id))} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-50">
          <Trash2 className="size-3.5" aria-hidden="true" /> Void
        </button>
      )}
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}
