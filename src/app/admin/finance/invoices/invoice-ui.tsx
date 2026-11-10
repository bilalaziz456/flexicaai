"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { Download, Pencil, Printer, RotateCcw, Trash2 } from "lucide-react";
import { Dialog } from "@/core/ui/dialog";
import { ActionMenu, type ActionMenuSection } from "@/core/ui/action-menu";
import { downloadDocument } from "@/core/ui/download-link";
import { printDocument } from "@/core/ui/print-links";
import {
  editClinicInvoiceAction,
  issueClinicInvoiceAction,
  saveInvoiceTaxSettingsAction,
  voidClinicInvoiceAction,
  restoreClinicInvoiceAction,
  type InvoiceActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DatePicker } from "@/core/ui/date-picker";
import { toast, useActionToast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { Checkbox } from "@/core/ui/checkbox";
import { formatRate, invoiceTax } from "@/core/admin/invoice-status";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoiceClinic = { id: string; name: string; monthlyPrice: number };

/** The company's tax defaults — what "Add tax" starts from. */
export type TaxDefaults = { label: string; rate: number };

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * "Add tax" — a tick, and when ticked the tax's name and rate, with the tax and the
 * total worked out as you type (the same `invoiceTax` the server stores). Off by
 * default: whether tax applies depends on the company's registration and the clinic's
 * province, so it is a deliberate choice on each invoice, never automatic.
 */
function TaxFields({
  idPrefix,
  amount,
  on,
  setOn,
  label,
  setLabel,
  rate,
  setRate,
}: {
  idPrefix: string;
  amount: number;
  on: boolean;
  setOn: (v: boolean) => void;
  label: string;
  setLabel: (v: string) => void;
  rate: string;
  setRate: (v: string) => void;
}) {
  const tax = on ? invoiceTax(amount, Number(rate)) : 0;
  return (
    <div className="space-y-2 rounded-lg border border-border/70 well p-3">
      {/* The tick is a value being submitted, so a Checkbox (conventions §6); it travels
          in a hidden input because the primitive is controlled. */}
      <input type="hidden" name="addTax" value={on ? "1" : ""} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={on} onCheckedChange={setOn} aria-label="Add tax to this invoice" />
        Add tax
      </label>
      {on ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-tax-label`} className="text-xs text-muted-foreground">Tax name</Label>
            <Input
              id={`${idPrefix}-tax-label`}
              name="taxLabel"
              className="h-8"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Sales tax (PRA)"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-tax-rate`} className="text-xs text-muted-foreground">Rate (%)</Label>
            <input
              id={`${idPrefix}-tax-rate`}
              name="taxRate"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={100}
              step={0.01}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={inputCls}
              required
            />
          </div>
          <p className="pb-1.5 text-sm tabular-nums text-muted-foreground">
            Tax {rs(tax)} · Total <span className="font-semibold text-foreground">{rs(amount + tax)}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Issue a subscription invoice to a clinic (sub_invoices:create). */
export function IssueInvoiceForm({ clinics, taxDefaults }: { clinics: InvoiceClinic[]; taxDefaults: TaxDefaults }) {
  const [clinicId, setClinicId] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [due, setDue] = useState("");
  const [taxOn, setTaxOn] = useState(false);
  const [taxLabel, setTaxLabel] = useState(taxDefaults.label);
  const [taxRate, setTaxRate] = useState(formatRate(taxDefaults.rate));

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
        setDue("");
        // The tick is left as it was: invoices issued in a row usually share their tax.
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
    <ActionForm action={formAction} state={state} className="space-y-3">
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="periodStart" value={start} />
      <input type="hidden" name="periodEnd" value={end} />
      <input type="hidden" name="dueOn" value={due} />
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
        <div className="space-y-1">
          <Label htmlFor="inv-due" className="text-xs text-muted-foreground">Due date (optional)</Label>
          <DatePicker id="inv-due" ariaLabel="Due date" value={due} onChange={setDue} />
          <p className="text-[11px] text-muted-foreground">Empty = the period start plus the clinic&rsquo;s grace days.</p>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="inv-note" className="text-xs text-muted-foreground">Note</Label>
          <Input id="inv-note" name="note" className="h-8" placeholder="e.g. July 2026 subscription" />
        </div>
      </div>
      <TaxFields
        idPrefix="inv"
        amount={Number(amount) || 0}
        on={taxOn}
        setOn={setTaxOn}
        label={taxLabel}
        setLabel={setTaxLabel}
        rate={taxRate}
        setRate={setTaxRate}
      />
      <Button type="submit" disabled={pending || !clinicId}>{pending ? "Issuing…" : "Issue invoice"}</Button>
    </ActionForm>
  );
}

/** What the edit dialog starts from — the invoice as it stands. */
export type EditableInvoice = {
  id: string;
  label: string;
  clinicName: string;
  /** Before tax. */
  amount: number;
  taxLabel: string | null;
  taxRate: number | null;
  paid: number;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  note: string | null;
};

/**
 * Correct an issued invoice (sub_invoices:edit): amount, period, due date, note. The
 * clinic and the number are fixed — payments are recorded against the invoice, and the
 * number may already be quoted back to us.
 */
function EditInvoiceDialog({
  invoice,
  taxDefaults,
  open,
  onOpenChange,
}: {
  invoice: EditableInvoice;
  taxDefaults: TaxDefaults;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [amount, setAmount] = useState(String(invoice.amount));
  // An invoice that has tax keeps ITS label and rate; one without starts from today's
  // defaults if the tick is turned on.
  const [taxOn, setTaxOn] = useState(invoice.taxRate !== null);
  const [taxLabel, setTaxLabel] = useState(invoice.taxLabel ?? taxDefaults.label);
  const [taxRate, setTaxRate] = useState(formatRate(invoice.taxRate ?? taxDefaults.rate));
  const [start, setStart] = useState(invoice.periodStart ?? "");
  const [end, setEnd] = useState(invoice.periodEnd ?? "");
  const [due, setDue] = useState(invoice.dueOn ?? "");
  // Closing the dialog is part of saving, so it happens in the action once the server
  // has accepted the edit (conventions §5), not in an effect watching `saved`.
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    async (prev, fd) => {
      const res = await editClinicInvoiceAction(invoice.id, prev, fd);
      if (res.saved) {
        // Toasted here, not by `useActionToast`: closing unmounts this dialog, so a
        // hook in it would never see the saved state. (An error stays inline below.)
        toast.success(`${invoice.label} updated.`);
        onOpenChange(false);
      }
      return res;
    },
    {},
  );
  const newAmount = Number(amount) || 0;
  const newTotal = newAmount + (taxOn ? invoiceTax(newAmount, Number(taxRate)) : 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Edit ${invoice.label}`}
      description={`${invoice.clinicName}. The clinic and the invoice number cannot be changed.`}
    >
      <ActionForm action={formAction} state={state} className="space-y-3">
        <input type="hidden" name="periodStart" value={start} />
        <input type="hidden" name="periodEnd" value={end} />
        <input type="hidden" name="dueOn" value={due} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`edit-amount-${invoice.id}`} className="text-xs text-muted-foreground">Amount (Rs)</Label>
            <input
              id={`edit-amount-${invoice.id}`}
              name="amount"
              type="number"
              inputMode="numeric"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className={inputCls}
              required
            />
            {invoice.paid > 0 && newTotal > 0 && newTotal < invoice.paid ? (
              <p className="text-[11px] text-warning-text">
                Rs {invoice.paid.toLocaleString("en-PK")} is already paid on it. It will show as paid, with Rs{" "}
                {(invoice.paid - newTotal).toLocaleString("en-PK")} paid in excess.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-due-${invoice.id}`} className="text-xs text-muted-foreground">Due date</Label>
            <DatePicker id={`edit-due-${invoice.id}`} ariaLabel="Due date" value={due} onChange={setDue} />
            <p className="text-[11px] text-muted-foreground">Empty = the period start plus the clinic&rsquo;s grace days.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-start-${invoice.id}`} className="text-xs text-muted-foreground">Period start</Label>
            <DatePicker id={`edit-start-${invoice.id}`} ariaLabel="Period start" value={start} onChange={setStart} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-end-${invoice.id}`} className="text-xs text-muted-foreground">Period end</Label>
            <DatePicker id={`edit-end-${invoice.id}`} ariaLabel="Period end" value={end} onChange={setEnd} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`edit-note-${invoice.id}`} className="text-xs text-muted-foreground">Note</Label>
            <Input id={`edit-note-${invoice.id}`} name="note" className="h-8" defaultValue={invoice.note ?? ""} />
          </div>
        </div>
        <TaxFields
          idPrefix={`edit-${invoice.id}`}
          amount={newAmount}
          on={taxOn}
          setOn={setTaxOn}
          label={taxLabel}
          setLabel={setTaxLabel}
          rate={taxRate}
          setRate={setTaxRate}
        />
        {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/**
 * A row's "⋯" menu: edit, print, download, void / restore. The row itself shows only
 * its next step (Record payment) — with Status, Due, Paid and Balance added, the old
 * row of five inline actions no longer fitted and was clipped off the right edge.
 */
export function InvoiceRowMenu({
  invoice,
  taxDefaults,
  deleted,
  canEdit,
  canDelete,
}: {
  invoice: EditableInvoice;
  taxDefaults: TaxDefaults;
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { id, label } = invoice;
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<InvoiceActionState>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else toast.success(done);
    });
  const printHref = `/admin/finance/invoices/${id}/print`;
  const icon = "size-3.5 text-muted-foreground";

  const sections: ActionMenuSection[] = [];
  if (!deleted && canEdit) {
    sections.push({
      kind: "actions",
      items: [{ label: "Edit", icon: <Pencil className={icon} aria-hidden="true" />, onSelect: () => setEditOpen(true) }],
    });
  }
  if (!deleted) {
    sections.push({
      kind: "actions",
      items: [
        { label: "Print", icon: <Printer className={icon} aria-hidden="true" />, onSelect: () => printDocument(printHref, "a4", {}) },
        { label: "Download PDF", icon: <Download className={icon} aria-hidden="true" />, onSelect: () => downloadDocument(printHref) },
      ],
    });
  }
  if (canDelete && !pending) {
    sections.push({
      kind: "actions",
      items: [
        deleted
          ? {
              label: "Restore",
              icon: <RotateCcw className={icon} aria-hidden="true" />,
              onSelect: () => run(() => restoreClinicInvoiceAction(id), `${label} restored.`),
            }
          : {
              label: "Void",
              icon: <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />,
              onSelect: () => run(() => voidClinicInvoiceAction(id), `${label} voided. It is in Trash.`),
            },
      ],
    });
  }
  if (sections.length === 0) return null;
  return (
    <>
      <ActionMenu label={`More actions for ${label}`} sections={sections} />
      {/* Mounted only while open, so it always starts from the invoice as it is now. */}
      {editOpen ? <EditInvoiceDialog invoice={invoice} taxDefaults={taxDefaults} open={editOpen} onOpenChange={setEditOpen} /> : null}
    </>
  );
}

/**
 * The company's tax details (full admins): what "Add tax" starts from, and the NTN /
 * STRN printed on an invoice that carries tax. Changing them never re-prices an invoice already
 * issued — each keeps the tax it was given.
 */
export function InvoiceTaxSettingsForm({
  taxLabel,
  taxRate,
  ntn,
  strn,
}: {
  taxLabel: string;
  taxRate: number;
  ntn: string | null;
  strn: string | null;
}) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(saveInvoiceTaxSettingsAction, {});
  useActionToast(state, { saved: "Tax details saved.", error: true });
  return (
    <ActionForm action={formAction} state={state} resetWhen={() => false} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="tax-default-label" className="text-xs text-muted-foreground">Tax name</Label>
          <Input id="tax-default-label" name="taxLabel" className="h-8" defaultValue={taxLabel} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax-default-rate" className="text-xs text-muted-foreground">Default rate (%)</Label>
          <input
            id="tax-default-rate"
            name="taxRate"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            defaultValue={formatRate(taxRate)}
            className={inputCls}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax-ntn" className="text-xs text-muted-foreground">NTN</Label>
          <Input id="tax-ntn" name="ntn" className="h-8" defaultValue={ntn ?? ""} placeholder="Not printed when empty" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax-strn" className="text-xs text-muted-foreground">Sales tax registration no. (STRN)</Label>
          <Input id="tax-strn" name="strn" className="h-8" defaultValue={strn ?? ""} placeholder="Not printed when empty" />
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save tax details"}</Button>
    </ActionForm>
  );
}
