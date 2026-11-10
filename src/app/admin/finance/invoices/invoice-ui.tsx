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
import { formatRate, invoiceTax, taxForProvince, type ProvinceTaxMap } from "@/core/admin/invoice-status";
import { PROVINCES, provinceLabel } from "@/core/clinics/provinces";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoiceClinic = { id: string; name: string; monthlyPrice: number; province: string | null };

/**
 * What "Add tax" starts from: the clinic's province's tax when one is set
 * (`byProvince`), otherwise the company default (`label` / `rate`).
 */
export type TaxDefaults = { label: string; rate: number; byProvince: ProvinceTaxMap };

/** A name to suggest per province: who collects sales tax on services there. */
const TAX_AUTHORITY_EXAMPLE: Partial<Record<string, string>> = {
  punjab: "Sales tax (PRA)",
  sindh: "Sales tax (SRB)",
  kpk: "Sales tax (KPRA)",
  balochistan: "Sales tax (BRA)",
  ict: "Sales tax (FBR)",
};

/** The clinic's starting tax, and a line saying where it came from. */
function startingTax(defaults: TaxDefaults, province: string | null | undefined) {
  const t = taxForProvince(defaults.byProvince, province, defaults);
  const source = t.fromProvince
    ? `${provinceLabel(province)} rate`
    : province
      ? `No rate set for ${provinceLabel(province)}, so the default is used`
      : "The clinic has no province set, so the default is used";
  return { label: t.label, rate: formatRate(t.rate), source, fromProvince: t.fromProvince };
}

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
  source,
}: {
  idPrefix: string;
  /** Where the starting name and rate came from (the clinic's province, or the default). */
  source?: React.ReactNode;
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
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem] sm:items-end">
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
          <p className="text-sm tabular-nums text-muted-foreground sm:col-span-2">
            Tax {rs(tax)} · Total <span className="font-semibold text-foreground">{rs(amount + tax)}</span>
          </p>
          {source ? <p className="text-[11px] text-muted-foreground sm:col-span-2">{source}</p> : null}
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
  const [taxSource, setTaxSource] = useState<string | null>(null);

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

  // Pre-fill the amount with the selected clinic's monthly price, and the tax with its
  // province's (sales tax on services is provincial). Both stay editable.
  function onPickClinic(id: string) {
    setClinicId(id);
    const c = clinics.find((x) => x.id === id);
    if (c && c.monthlyPrice > 0) setAmount(String(c.monthlyPrice));
    if (c) {
      const t = startingTax(taxDefaults, c.province);
      setTaxLabel(t.label);
      setTaxRate(t.rate);
      setTaxSource(t.source);
    }
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
        source={taxSource}
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
  clinicProvince: string | null;
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
  // Editing follows the clinic's province, like issuing does (owner, 2026-11-11): the
  // tax fields open on the province's rate. An invoice issued at a different rate says
  // so, with one click to keep its own — saving with the province rate changes what the
  // clinic owes, and the activity log records old → new. With no province rate (none
  // set, or no province) an invoice keeps the tax it was issued with.
  const startTax = startingTax(taxDefaults, invoice.clinicProvince);
  const own =
    invoice.taxRate !== null
      ? { label: invoice.taxLabel ?? "Sales tax", rate: formatRate(invoice.taxRate) }
      : null;
  const initialTax = own && !startTax.fromProvince ? own : startTax;
  const [taxOn, setTaxOn] = useState(invoice.taxRate !== null);
  const [taxLabel, setTaxLabel] = useState(initialTax.label);
  const [taxRate, setTaxRate] = useState(initialTax.rate);
  const keepingOwn = own !== null && taxLabel === own.label && taxRate === own.rate;
  const ownDiffers = own !== null && startTax.fromProvince && (own.label !== startTax.label || own.rate !== startTax.rate);
  let taxSource: React.ReactNode;
  if (own && !startTax.fromProvince) taxSource = "The tax this invoice was issued with";
  else if (ownDiffers && !keepingOwn) {
    taxSource = (
      <>
        {startTax.source}. This invoice was issued with {own.label} {own.rate}%.{" "}
        <button
          type="button"
          className="font-medium text-primary-text underline underline-offset-2"
          onClick={() => {
            setTaxLabel(own.label);
            setTaxRate(own.rate);
          }}
        >
          Keep {own.rate}%
        </button>
      </>
    );
  } else if (ownDiffers && keepingOwn) {
    taxSource = (
      <>
        Keeping the tax this invoice was issued with.{" "}
        <button
          type="button"
          className="font-medium text-primary-text underline underline-offset-2"
          onClick={() => {
            setTaxLabel(startTax.label);
            setTaxRate(startTax.rate);
          }}
        >
          Use the {startTax.source}
        </button>
      </>
    );
  } else taxSource = startTax.source;
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
          source={taxSource}
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
  provinceTax,
}: {
  taxLabel: string;
  taxRate: number;
  ntn: string | null;
  strn: string | null;
  provinceTax: ProvinceTaxMap;
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
      {/* One row per province: an invoice to a clinic there starts from this. A blank
          rate leaves that province on the default above. */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Tax by the clinic&rsquo;s province (empty rate = use the default)
        </p>
        <div className="divide-y divide-border/60 rounded-lg border border-border/70 well">
          {PROVINCES.map((p) => (
            <div key={p.code} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[12rem_1fr_7rem]">
              <span className="text-sm">{p.label}</span>
              <Input
                name={`prov_${p.code}_label`}
                aria-label={`Tax name for ${p.label}`}
                className="h-8"
                defaultValue={provinceTax[p.code]?.label ?? ""}
                placeholder={`e.g. ${TAX_AUTHORITY_EXAMPLE[p.code] ?? "Sales tax"}`}
              />
              <input
                name={`prov_${p.code}_rate`}
                aria-label={`Tax rate for ${p.label} (%)`}
                type="number"
                inputMode="decimal"
                min={0.01}
                max={100}
                step={0.01}
                defaultValue={provinceTax[p.code] ? formatRate(provinceTax[p.code]!.rate) : ""}
                placeholder="%"
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save tax details"}</Button>
    </ActionForm>
  );
}
