"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { describePeriodLength, periodEndFor, periodLength, type PeriodLength } from "@/core/admin/invoice-status";
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
import { SelectField } from "@/core/ui/select-field";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";
import { recordClinicPaymentAction, type AdminActionState } from "@/app/admin/actions";
import { formatRate, invoiceTax, taxForProvince, type ProvinceTaxMap } from "@/core/admin/invoice-status";
import { PROVINCES, provinceLabel } from "@/core/clinics/provinces";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type InvoiceClinic = {
  id: string;
  name: string;
  monthlyPrice: number;
  province: string | null;
  /** One-time fees not on an invoice yet (0152) — offered as tick boxes. */
  fees: { id: string; label: string; amount: number }[];
};

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

/**
 * The amount for a period at a monthly price (owner, 2026-11-16): each whole month at the
 * monthly price, and a part month pro rata on a 30-day month (10 days = a third).
 */
function amountForPeriod(monthlyPrice: number, len: PeriodLength): number {
  return monthlyPrice * len.months + Math.round((monthlyPrice * len.days) / 30);
}

/** Issue a subscription invoice to a clinic (sub_invoices:create). */
export function IssueInvoiceForm({ clinics, taxDefaults }: { clinics: InvoiceClinic[]; taxDefaults: TaxDefaults }) {
  const [clinicId, setClinicId] = useState("");
  const [amount, setAmount] = useState("");
  // Owner, 2026-11-16: an invoice may cover several months paid together, and the
  // PERIOD decides how many — pick start and end, and the amount becomes the clinic's
  // monthly price × the months between them. It is filled, not locked: once someone
  // types an amount themselves (a discount for paying a year ahead) changing the dates
  // or the clinic no longer overwrites it.
  const [amountTyped, setAmountTyped] = useState(false);
  // One-time fees ticked to bill on this invoice (0152). Picking a clinic ticks all of
  // its open fees — an onboarding invoice usually carries them — and each can be unticked.
  const [feeIds, setFeeIds] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [due, setDue] = useState("");
  const [taxOn, setTaxOn] = useState(false);
  const [taxLabel, setTaxLabel] = useState(taxDefaults.label);
  const [taxRate, setTaxRate] = useState(formatRate(taxDefaults.rate));
  const [taxSource, setTaxSource] = useState<string | null>(null);

  // Clearing the form is part of issuing the invoice, so it happens in the action
  // once the server has accepted it — not in an effect that watches for the save to
  // have happened and then re-renders to undo the fields.
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    async (prev, fd) => {
      const res = await issueClinicInvoiceAction(prev, fd);
      if (res.saved) {
        setClinicId("");
        setAmount("");
        setAmountTyped(false);
        setFeeIds([]);
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

  const picked = clinics.find((x) => x.id === clinicId);
  const pickedFees = (picked?.fees ?? []).filter((f) => feeIds.includes(f.id));
  const feesTotal = pickedFees.reduce((sum, f) => sum + f.amount, 0);
  const len = periodLength(start, end);
  const computed = picked && picked.monthlyPrice > 0 ? (len ? amountForPeriod(picked.monthlyPrice, len) : picked.monthlyPrice) : null;

  /** Re-fill the amount for this clinic and period, unless someone typed their own. */
  function refill(c: InvoiceClinic | undefined, s: string, e: string, force = false) {
    if ((amountTyped && !force) || !c || c.monthlyPrice <= 0) return;
    const l = periodLength(s, e);
    setAmount(String(l ? amountForPeriod(c.monthlyPrice, l) : c.monthlyPrice));
  }

  function onStart(v: string) {
    setStart(v);
    // A new start with no end yet (or an end now before it) proposes one month.
    const nextEnd = v && (!end || end < v) ? periodEndFor(v, 1) : end;
    if (nextEnd !== end) setEnd(nextEnd);
    refill(picked, v, nextEnd);
  }

  function onEnd(v: string) {
    setEnd(v);
    refill(picked, start, v);
  }

  // Pre-fill the amount with the selected clinic's price for the period, and the tax with
  // its province's (sales tax on services is provincial). Both stay editable.
  function onPickClinic(id: string) {
    setClinicId(id);
    const c = clinics.find((x) => x.id === id);
    setAmountTyped(false);
    setFeeIds((c?.fees ?? []).map((f) => f.id));
    refill(c, start, end, true);
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
      {pickedFees.map((f) => (
        <input key={f.id} type="hidden" name="feeId" value={f.id} />
      ))}
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
          <Label htmlFor="inv-amount" className="text-xs text-muted-foreground">
            {picked && picked.fees.length > 0 ? "Subscription (Rs)" : "Amount (Rs)"}
          </Label>
          <input
            id="inv-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d]/g, ""));
              setAmountTyped(true);
            }}
            className={inputCls}
            required
          />
          {picked && computed !== null ? (
            amountTyped && Number(amount) !== computed ? (
              <button
                type="button"
                className="text-[11px] text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setAmountTyped(false);
                  setAmount(String(computed));
                }}
              >
                Use Rs {computed.toLocaleString("en-PK")}{len ? ` (${describePeriodLength(len)})` : ""}
              </button>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {len
                  ? `Rs ${picked.monthlyPrice.toLocaleString("en-PK")}/mo × ${describePeriodLength(len)}`
                  : "One month — pick the period to bill more"}
              </p>
            )
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-start" className="text-xs text-muted-foreground">Period start</Label>
          <DatePicker id="inv-start" ariaLabel="Period start" value={start} onChange={onStart} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-end" className="text-xs text-muted-foreground">Period end</Label>
          <DatePicker id="inv-end" ariaLabel="Period end" value={end} onChange={onEnd} />
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
      {picked && picked.fees.length > 0 ? (
        <div className="space-y-2 rounded-md border well p-3">
          <div className="text-xs font-medium text-muted-foreground">One-time fees to bill on this invoice</div>
          {picked.fees.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={feeIds.includes(f.id)}
                  onCheckedChange={(on) => setFeeIds((cur) => (on ? [...cur, f.id] : cur.filter((x) => x !== f.id)))}
                  aria-label={`Bill ${f.label}`}
                />
                {f.label}
              </span>
              <span className="tabular-nums">Rs {f.amount.toLocaleString("en-PK")}</span>
            </label>
          ))}
          <p className="border-t pt-2 text-xs text-muted-foreground">
            Subscription Rs {(Number(amount) || 0).toLocaleString("en-PK")} + fees Rs {feesTotal.toLocaleString("en-PK")} ={" "}
            <span className="font-semibold text-foreground">Rs {((Number(amount) || 0) + feesTotal).toLocaleString("en-PK")}</span> before tax.
            Set the subscription to 0 to bill the fees alone.
          </p>
        </div>
      ) : null}
      <TaxFields
        idPrefix="inv"
        amount={(Number(amount) || 0) + feesTotal}
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
  /** Before tax — the SUBSCRIPTION part; one-time fees are `feeAmount` (kept as issued). */
  amount: number;
  feeAmount: number;
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
  // Tax is on the whole: the subscription as typed plus the fees billed on it.
  const newAmount = (Number(amount) || 0) + invoice.feeAmount;
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
            <Label htmlFor={`edit-amount-${invoice.id}`} className="text-xs text-muted-foreground">
              {invoice.feeAmount > 0 ? "Subscription (Rs)" : "Amount (Rs)"}
            </Label>
            <input
              id={`edit-amount-${invoice.id}`}
              name="amount"
              type="number"
              inputMode="numeric"
              min={invoice.feeAmount > 0 ? 0 : 1}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className={inputCls}
              required
            />
            {invoice.feeAmount > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                + Rs {invoice.feeAmount.toLocaleString("en-PK")} one-time fees, kept as issued.
              </p>
            ) : null}
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

/**
 * "Record payment" on an invoice row — the payment is recorded AGAINST this invoice
 * from the list itself, instead of sending the admin to the clinic's billing card
 * (owner, 2026-11-17). Same action and rules as that card (`recordClinicPaymentAction`):
 * the amount starts at what the invoice still owes, any one-time fees on it are paid
 * first, and partial payments are fine.
 */
export function RecordInvoicePaymentButton({
  invoiceId,
  clinicId,
  label,
  clinicName,
  balance,
  today,
}: {
  invoiceId: string;
  clinicId: string;
  label: string;
  clinicName: string;
  balance: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [occurredAt, setOccurredAt] = useState(today);
  const methodOptions = useTenderOptions();
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(async (prev, fd) => {
    const res = await recordClinicPaymentAction(clinicId, prev, fd);
    if (res.saved) setOpen(false);
    return res;
  }, {});
  useActionToast(state, { saved: `Payment recorded on ${label}.`, error: true });
  const paying = Number(amount) || 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 whitespace-nowrap text-xs"
        onClick={() => {
          setAmount(String(balance));
          setOccurredAt(today);
          setOpen(true);
        }}
      >
        Record payment
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="md"
        title={`Record payment · ${label}`}
        description={`${clinicName}. Rs ${balance.toLocaleString("en-PK")} still to be paid on this invoice.`}
      >
        <ActionForm action={formAction} state={state} className="space-y-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="kind" value="payment" />
          <input type="hidden" name="occurredAt" value={occurredAt} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`pay-amount-${invoiceId}`} className="text-xs text-muted-foreground">Amount (Rs)</Label>
              <input
                id={`pay-amount-${invoiceId}`}
                name="amount"
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                className={inputCls}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                {paying > 0 && paying < balance
                  ? `Part payment: Rs ${(balance - paying).toLocaleString("en-PK")} will still be owed.`
                  : paying > balance
                    ? `Rs ${(paying - balance).toLocaleString("en-PK")} more than the invoice owes.`
                    : "Pays the invoice in full."}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pay-date-${invoiceId}`} className="text-xs text-muted-foreground">Date</Label>
              <DatePicker id={`pay-date-${invoiceId}`} ariaLabel="Payment date" value={occurredAt} onChange={setOccurredAt} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pay-method-${invoiceId}`} className="text-xs text-muted-foreground">Method</Label>
              <SelectField
                id={`pay-method-${invoiceId}`}
                name="method"
                defaultValue="bank"
                options={methodOptions.map((m) => ({ value: m.value, label: m.label }))}
                ariaLabel="Payment method"
                className="h-8 w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pay-ref-${invoiceId}`} className="text-xs text-muted-foreground">Reference</Label>
              <Input id={`pay-ref-${invoiceId}`} name="reference" className="h-8" placeholder="Txn / cheque no." />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`pay-note-${invoiceId}`} className="text-xs text-muted-foreground">Note</Label>
              <Input id={`pay-note-${invoiceId}`} name="note" className="h-8" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record payment"}</Button>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
