"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import {
  recordClinicPaymentAction,
  setClinicPaymentInvoiceAction,
  setClinicPrice,
  setPaymentNoticeEnabledAction,
  setPaymentReminderDaysAction,
  voidClinicPaymentAction,
  type AdminActionState,
} from "@/app/admin/actions";
import { SelectField } from "@/core/ui/select-field";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DataTable, type Column } from "@/core/ui/data-table";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Switch } from "@/core/ui/switch";
import { Label } from "@/core/ui/label";
import { ActionToast, toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";
import {
  formatIsoDay,
  formatPeriod,
  invoiceStatus,
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/core/admin/invoice-status";

const CYCLES = [
  { id: "monthly", label: "Monthly" },
  { id: "2m", label: "2-monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "half", label: "Half-yearly" },
  { id: "annual", label: "Annual" },
];

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export type BillingBalance = {
  billingStatus: "free" | "active" | "due" | "overdue";
  paidThrough: string;
  monthsPaid: number;
  totalPaid: number;
  accrued: number;
  owed: number;
  credit: number;
  daysRemaining: number;
  daysOverdue: number;
};
export type BillingPayment = {
  id: string;
  amount: number;
  kind: string;
  method: string | null;
  reference: string | null;
  monthsCovered: number;
  note: string | null;
  occurredAt: string;
  recordedByName: string | null;
  invoiceId: string | null;
};
/** A live subscription invoice of this clinic, with what is recorded against it. */
export type BillingInvoice = {
  id: string;
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  amount: number;
  paid: number;
};

const NO_INVOICE = "none";

function StatusBadge({ s }: { s: BillingBalance["billingStatus"] }) {
  const map = {
    active: ["Active", "success"],
    due: ["Due", "warning"],
    overdue: ["Overdue", "destructive"],
    free: ["Free", "secondary"],
  } as const;
  const [label, variant] = map[s];
  return <Badge variant={variant}>{label}</Badge>;
}

export function ClinicBilling({
  clinicId,
  monthlyPrice,
  billingCycle,
  graceDays,
  balance,
  payments,
  commitmentAt,
  commitmentNote,
  canManage = true,
  paymentNoticeEnabled,
  paymentReminderDays,
  canToggleNotice = false,
  invoices = [],
  today,
  prefillInvoiceId,
  canLinkPayments = false,
}: {
  clinicId: string;
  monthlyPrice: number;
  billingCycle: string;
  graceDays: number;
  commitmentAt: string | null;
  commitmentNote: string | null;
  balance: BillingBalance;
  payments: BillingPayment[];
  /** False = read-only (billing:view): show status + history, hide the edit forms. */
  canManage?: boolean;
  /** Whether the clinic-facing payment-due notice is on (shown to clinic staff). */
  paymentNoticeEnabled: boolean;
  /** Days before the paid-through date the clinic shows in "payment coming up". */
  paymentReminderDays: number;
  /** May flip the notice + reminder — owner/super-admin or the account manager. */
  canToggleNotice?: boolean;
  /** The clinic's live subscription invoices, oldest first. */
  invoices?: BillingInvoice[];
  /** YYYY-MM-DD on the server, so the overdue mark cannot differ between server and browser. */
  today: string;
  /** "Record payment" from the invoices page: open the form filled in for this one. */
  prefillInvoiceId?: string;
  /** May link / unlink a recorded payment to an invoice (billing:edit). */
  canLinkPayments?: boolean;
}) {
  // Methods come from the database (ADR-027): active only, in its own order.
  const methodOptions = useTenderOptions();
  const [priceState, priceAction, savingPrice] = useActionState<AdminActionState, FormData>(
    setClinicPrice.bind(null, clinicId),
    {},
  );
  const [payState, payAction, paying] = useActionState<AdminActionState, FormData>(
    recordClinicPaymentAction.bind(null, clinicId),
    {},
  );
  // The two date pickers are controlled, so they must be cleared alongside the native
  // fields React resets after a successful submit — otherwise the form half-clears and
  // the next payment silently inherits this one's date. Adjusted during render (React's
  // "adjust state when a prop changes") rather than in an effect, and keyed on the state
  // OBJECT: `saved` goes true → true, so two payments in a row would look like no change
  // and the second would keep the first's date.
  const [occurredAt, setOccurredAt] = useState("");
  // NOT named `commitmentAt`: that is already a PROP — the clinic's CURRENT follow-up
  // date. This is the one being entered now, and shadowing the prop hid it.
  const [newCommitmentAt, setNewCommitmentAt] = useState("");

  // Each invoice's status, worked out once with the same rules as the invoices page.
  const invoiceRows = invoices.map((inv) => ({ ...inv, status: invoiceStatus(inv.amount, inv.paid, inv.dueOn, today) }));
  const owing = invoiceRows.filter((i) => i.status.balance > 0);
  const invoiceLabel = (id: string | null) => invoices.find((i) => i.id === id)?.label ?? null;

  // The invoice this payment is for, and its amount — both controlled so "Record
  // payment" on an invoice (here, or arriving from the invoices page) can fill them in.
  const prefill = owing.find((i) => i.id === prefillInvoiceId);
  const [payInvoiceId, setPayInvoiceId] = useState(prefill?.id ?? NO_INVOICE);
  const [amountVal, setAmountVal] = useState(prefill ? String(prefill.status.balance) : "");

  const [lastPayState, setLastPayState] = useState(payState);
  if (payState !== lastPayState) {
    setLastPayState(payState);
    if (payState.saved) {
      setOccurredAt("");
      setNewCommitmentAt("");
      setPayInvoiceId(NO_INVOICE);
      setAmountVal("");
    }
  }

  function startPaymentFor(inv: (typeof invoiceRows)[number]) {
    setKind("payment");
    setPayInvoiceId(inv.id);
    setAmountVal(String(inv.status.balance));
    document.getElementById("record-payment")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("amount")?.focus({ preventScroll: true });
  }

  const [linking, startLinking] = useTransition();
  function linkPayment(paymentId: string, next: string) {
    startLinking(async () => {
      const r = await setClinicPaymentInvoiceAction(clinicId, paymentId, next === NO_INVOICE ? null : next);
      if (r.error) toast.error(r.error);
      else toast.success(next === NO_INVOICE ? "Payment unlinked from its invoice." : `Payment linked to ${invoiceLabel(next) ?? "the invoice"}.`);
    });
  }

  // Clinic-facing payment-due notice toggle (optimistic; reverts on error).
  //
  // A switch that writes to the server needs to SAY it wrote. Optimistic movement is
  // the thing being toggled, not confirmation of anything — the knob slides whether or
  // not the request lands, so without a toast "on" and "failed to turn on" look
  // identical until the next page load.
  const [noticeOn, setNoticeOn] = useState(paymentNoticeEnabled);
  const [togglingNotice, startNotice] = useTransition();
  const toggleNotice = (next: boolean) => {
    setNoticeOn(next);
    startNotice(async () => {
      const r = await setPaymentNoticeEnabledAction(clinicId, next);
      if (r.error) {
        setNoticeOn(!next);
        toast.error(r.error);
        return;
      }
      // Naming the resulting state, not just "Saved" — the person is looking at a
      // knob that already moved, so the useful confirmation is which way it landed.
      toast.success(
        next
          ? "Payment notice turned on. Clinic staff will see it while payment is due."
          : "Payment notice turned off. Clinic staff will no longer be reminded.",
      );
    });
  };
  // "Payment coming up" reminder window (days before the paid-through date). Saves on
  // blur; reverts to the last saved value on error.
  const [reminderVal, setReminderVal] = useState(String(paymentReminderDays));
  const [savedReminder, setSavedReminder] = useState(paymentReminderDays);
  const [savingReminder, startReminder] = useTransition();
  const [reminderErr, setReminderErr] = useState<string | null>(null);
  const saveReminder = () => {
    const n = Math.trunc(Number(reminderVal));
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      setReminderErr("Enter 0–90 days.");
      setReminderVal(String(savedReminder));
      return;
    }
    if (n === savedReminder) return;
    setReminderErr(null);
    startReminder(async () => {
      const r = await setPaymentReminderDaysAction(clinicId, n);
      if (r.error) {
        setReminderErr(r.error);
        setReminderVal(String(savedReminder));
      } else {
        setSavedReminder(n);
        // Was a boolean flipped back by a setTimeout — a private, untracked timer
        // re-rendering the card to un-say something. The toast store is the shared
        // version of that and already handles the dismissal.
        toast.success(
          n === 0
            ? "Pre-due heads-up turned off for this clinic."
            : `Reminder set to ${n} day${n === 1 ? "" : "s"} before the payment is due.`,
        );
      }
    });
  };
  // Controlled so Base UI's FieldControl doesn't warn when the card re-renders
  // after an action (uncontrolled defaultValue re-initialising).
  const [priceVal, setPriceVal] = useState(String(monthlyPrice));
  const [graceVal, setGraceVal] = useState(String(graceDays));
  // Payment / refund (money out) / credit (non-cash adjustment).
  const [kind, setKind] = useState("payment");
  const isPayment = kind === "payment";

  return (
    <div className="space-y-6">
      <ActionToast state={priceState} saved="Billing settings saved." />
      <ActionToast state={payState} saved="Recorded." />

      {/* ---- Balance summary ---- */}
      {/* The card's headline figures, so hairlines rather than a recess — the same
          correction the patient Account card needed. A well is for a grouping or an
          aside; these are the content. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 sm:grid-cols-4 sm:divide-y-0">
        <div className="p-3">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="mt-1"><StatusBadge s={balance.billingStatus} /></div>
        </div>
        <div className="p-3">
          <div className="text-xs text-muted-foreground">Paid through</div>
          <div className="mt-1 text-sm font-medium">{fmtDate(balance.paidThrough)}</div>
          <div className="text-xs text-muted-foreground">
            {balance.billingStatus === "free"
              ? "not billed"
              : balance.daysOverdue > 0
                ? `${balance.daysOverdue}d overdue`
                : `${balance.daysRemaining}d left`}
          </div>
        </div>
        <div className="p-3">
          <div className="text-xs text-muted-foreground">
            {balance.credit > 0 ? "Credit (paid ahead)" : "Owed (remaining)"}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              balance.owed > 0 ? "text-destructive" : balance.credit > 0 ? "text-success-text" : "",
            )}
          >
            {rs(balance.credit > 0 ? balance.credit : balance.owed)}
          </div>
          {balance.billingStatus !== "free" ? (
            <div className="text-xs text-muted-foreground">billed {rs(balance.accrued)}</div>
          ) : null}
        </div>
        <div className="p-3">
          <div className="text-xs text-muted-foreground">Total collected</div>
          <div className="mt-1 text-sm font-medium">{rs(balance.totalPaid)}</div>
          <div className="text-xs text-muted-foreground">{balance.monthsPaid} months paid</div>
        </div>
      </div>

      {/* Clinic-facing payment-due notice toggle (owner/super-admin/account manager). */}
      {canToggleNotice && monthlyPrice > 0 ? (
        <div className="flex items-start justify-between gap-3 rounded-md border well p-3">
          <div>
            <div className="text-sm font-medium">Show payment-due notice to clinic staff</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When on, every user in this clinic sees a due/overdue reminder in their workspace.
              Turn it off to stop reminding (e.g. a clinic on a payment plan). This does not affect
              the dues dashboard or the hard past-due lock.
            </p>
          </div>
          {/* Was a hand-rolled copy of the Switch primitive's markup, at its own size
              and with its own focus ring — the exact duplication core/ui exists to
              stop. This toggle takes effect immediately, so a switch is the right
              control; only the copy was wrong. */}
          <Switch
            checked={noticeOn}
            onCheckedChange={toggleNotice}
            disabled={togglingNotice}
            aria-label="Show payment-due notice to clinic staff"
            className="mt-0.5"
          />
        </div>
      ) : null}

      {/* "Payment coming up" reminder window (owner/super-admin/account manager). Shown
          regardless of price for discoverability; it only takes effect once a price is set. */}
      {canToggleNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border well p-3">
          <div>
            <div className="text-sm font-medium">Remind me before the payment is due</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Show this clinic in “Payments coming up” on the Clinics + Overview pages this
              many days before its paid-through date. 0 turns the heads-up off.
              {monthlyPrice > 0 ? "" : " Set a monthly price above for it to take effect."}
            </p>
            {reminderErr ? <p className="mt-1 text-xs text-destructive" role="alert">{reminderErr}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={90}
              inputMode="numeric"
              aria-label="Reminder days before due"
              value={reminderVal}
              disabled={savingReminder}
              onChange={(e) => setReminderVal(e.target.value)}
              onBlur={saveReminder}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="h-9 w-20 text-sm"
            />
            <span className="text-sm text-muted-foreground">days</span>
            {savingReminder ? (
              <span className="text-xs text-muted-foreground">Saving…</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Follow-up commitment on an outstanding balance. */}
      {commitmentAt && balance.owed > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/35 bg-warning/[0.06] px-3 py-2 text-sm text-warning-text">
          <span className="font-medium">Follow up {fmtDate(commitmentAt)}</span>
          <span className="text-muted-foreground">
           · {rs(balance.owed)} promised{commitmentNote ? ` · ${commitmentNote}` : ""}
          </span>
        </div>
      ) : null}

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Read-only: you can see billing status but not change price or record payments.
        </p>
      ) : null}

      {/* ---- Subscription invoices and whether each is paid (owner, 2026-11-11) ---- */}
      {invoiceRows.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-medium">Subscription invoices</div>
            <div className="text-xs text-muted-foreground">
              {owing.length === 0
                ? "All paid"
                : `${owing.length} not fully paid · ${rs(owing.reduce((s, i) => s + i.status.balance, 0))}`}
            </div>
          </div>
          <DataTable
            rows={invoiceRows}
            getRowKey={(i) => i.id}
            minWidthClassName="min-w-[40rem]"
            initialSort={{ id: "invoice", dir: "desc" }}
            empty="No invoices."
            columns={[
              { id: "invoice", header: "Invoice", cardTitle: true, sortValue: (i) => i.label, cell: (i) => <span className="font-medium">{i.label}</span> },
              { id: "period", header: "Period", cell: (i) => <span className="whitespace-nowrap text-muted-foreground">{formatPeriod(i.periodStart, i.periodEnd) ?? "—"}</span> },
              {
                id: "due",
                header: "Due",
                sortValue: (i) => i.dueOn ?? "",
                cell: (i) => (
                  <span className={cn("whitespace-nowrap", i.status.overdue ? "font-medium text-destructive" : "")}>
                    {i.dueOn ? formatIsoDay(i.dueOn) : "—"}
                  </span>
                ),
              },
              { id: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount, cell: (i) => <span className="tabular-nums">{rs(i.amount)}</span> },
              {
                id: "balance",
                header: "Balance",
                align: "right",
                sortValue: (i) => i.status.balance,
                cell: (i) => (
                  <span className={cn("tabular-nums", i.status.balance > 0 ? "font-medium" : "text-muted-foreground")}>
                    {i.status.balance > 0 ? rs(i.status.balance) : i.status.overpaid > 0 ? `${rs(i.status.overpaid)} over` : "—"}
                  </span>
                ),
              },
              {
                id: "status",
                header: "Status",
                // Room after the right-aligned Balance, or the two headings read as one word.
                headerClassName: "pl-6",
                cellClassName: "pl-6",
                cell: (i) => <Badge variant={invoiceStatusTone(i.status)}>{invoiceStatusLabel(i.status)}</Badge> },
              ...(canManage
                ? [
                    {
                      id: "actions",
                      header: "",
                      align: "right",
                      cell: (i) =>
                        i.status.balance > 0 ? (
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => startPaymentFor(i)}>
                            Record payment
                          </Button>
                        ) : null,
                    } as Column<(typeof invoiceRows)[number]>,
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {/* ---- Price / cycle / grace (manage only) ---- */}
      {canManage ? (
      <ActionForm action={priceAction} state={priceState} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="monthlyPrice">Monthly price (PKR)</Label>
            <Input id="monthlyPrice" name="monthlyPrice" type="number" min={0} value={priceVal} onChange={(e) => setPriceVal(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingCycle">Expected cycle</Label>
            <SelectField
              id="billingCycle"
              name="billingCycle"
              defaultValue={billingCycle}
              options={[...CYCLES.map((c) => ({ value: c.id, label: c.label }))]}
              ariaLabel="billingCycle"
              className="h-8 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="graceDays">Grace days</Label>
            <Input id="graceDays" name="graceDays" type="number" min={0} value={graceVal} onChange={(e) => setGraceVal(e.target.value)} />
          </div>
        </div>
        {priceState.error ? <p className="text-sm text-destructive" role="alert">{priceState.error}</p> : null}
        <Button type="submit" variant="outline" disabled={savingPrice}>
          {savingPrice ? "Saving…" : "Save billing settings"}
        </Button>
      </ActionForm>
      ) : null}

      {/* ---- Record a payment (manage only) ---- */}
      {canManage ? (
      <ActionForm id="record-payment" action={payAction} state={payState} className="scroll-mt-32 space-y-3 rounded-md border well p-4">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="invoiceId" value={payInvoiceId === NO_INVOICE ? "" : payInvoiceId} />
        <div className="text-sm font-medium">Record payment / refund / credit</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="kind">Type</Label>
            <SelectField
              id="kind"
              value={kind}
              onValueChange={(next) => setKind(next)}
              options={[{ value: "payment", label: "Payment (money in)" }, { value: "refund", label: "Refund (money out)" }, { value: "credit", label: "Credit (non-cash adjustment)" }]}
              ariaLabel="kind"
              className="h-8 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (PKR)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min={1}
              required
              value={amountVal}
              onChange={(e) => setAmountVal(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {isPayment
                ? "Partial ok: any remaining balance carries forward."
                : kind === "refund"
                  ? "Money returned to the clinic. Reduces their balance & our revenue."
                  : "Non-cash credit: reduces their balance without cash."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method</Label>
            <SelectField
              id="method"
              name="method"
              defaultValue="bank"
              options={[...methodOptions.map((m) => ({ value: m.value, label: m.label }))]}
              ariaLabel="method"
              className="h-8 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="occurredAt">Date</Label>
            {/* Themed picker, not `<input type="date">`, whose popup cannot be styled.
                It is controlled, so the value reaches the action through a hidden input
                — which needs no `syncChecked` care, since React keeps a hidden field's
                defaultValue in step across the post-action reset (conventions §5). */}
            <input type="hidden" name="occurredAt" value={occurredAt} />
            <DatePicker id="occurredAt" ariaLabel="Payment date" value={occurredAt} onChange={setOccurredAt} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" placeholder="Txn / cheque no." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Input id="note" name="note" />
          </div>
          {invoiceRows.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="payInvoice">For invoice</Label>
              <SelectField
                id="payInvoice"
                value={payInvoiceId}
                onValueChange={(next) => {
                  setPayInvoiceId(next);
                  const inv = owing.find((i) => i.id === next);
                  if (inv && kind === "payment") setAmountVal(String(inv.status.balance));
                }}
                options={[
                  { value: NO_INVOICE, label: "Not for an invoice" },
                  // Invoices still owed, plus the one already picked (a refund may be
                  // recorded against an invoice that is paid).
                  ...invoiceRows
                    .filter((i) => i.status.balance > 0 || i.id === payInvoiceId)
                    .map((i) => ({
                      value: i.id,
                      label: `${i.label} · ${i.status.balance > 0 ? `${rs(i.status.balance)} due` : "paid"}`,
                    })),
                ]}
                ariaLabel="Invoice this payment is for"
                className="h-8 w-full"
              />
              <p className="text-[11px] text-muted-foreground">Marks that invoice paid. The balance above counts it either way.</p>
            </div>
          ) : null}
        </div>

        {/* Follow-up on any remaining balance (payment only). */}
        {isPayment ? (
          <div className="grid gap-3 rounded-md border border-dashed well p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="commitmentAt">Follow-up date (if balance remains)</Label>
              <input type="hidden" name="commitmentAt" value={newCommitmentAt} />
              <DatePicker
                id="commitmentAt"
                ariaLabel="Follow-up date"
                value={newCommitmentAt}
                onChange={setNewCommitmentAt}
              />
              <p className="text-[11px] text-muted-foreground">
                When they promised to pay the rest. Cleared once settled.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="commitmentNote">Follow-up note</Label>
              <Input id="commitmentNote" name="commitmentNote" placeholder="e.g. will pay rest after 10 days" />
            </div>
          </div>
        ) : null}

        {payState.error ? <p className="text-sm text-destructive" role="alert">{payState.error}</p> : null}
        <Button type="submit" disabled={paying}>
          {paying ? "Saving…" : isPayment ? "Record payment" : kind === "refund" ? "Record refund" : "Record credit"}
        </Button>
      </ActionForm>
      ) : null}

      {/* ---- History ---- */}
      {payments.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">Payment history</div>
          <DataTable
            rows={payments}
            getRowKey={(p) => p.id}
            minWidthClassName="min-w-[38rem]"
            initialSort={{ id: "date", dir: "desc" }}
            empty="No payments yet."
            columns={[
              { id: "date", header: "Date", cardTitle: true, sortValue: (p) => p.occurredAt, cell: (p) => fmtDate(p.occurredAt) },
              {
                id: "type",
                header: "Type",
                sortValue: (p) => p.kind,
                cell: (p) =>
                  p.kind === "refund" ? (
                    <Badge variant="destructive">Refund</Badge>
                  ) : p.kind === "credit" ? (
                    <Badge variant="warning">Credit</Badge>
                  ) : (
                    <span className="text-muted-foreground">Payment</span>
                  ),
              },
              {
                id: "amount",
                header: "Amount",
                sortValue: (p) => (p.kind === "refund" ? -p.amount : p.amount),
                cell: (p) => (
                  <span className={cn("font-medium tabular-nums", p.kind === "refund" ? "text-destructive" : "")}>
                    {p.kind === "refund" ? `−${rs(p.amount)}` : rs(p.amount)}
                  </span>
                ),
              },
              { id: "method", header: "Method", sortValue: (p) => p.method ?? "", cell: (p) => <span className="capitalize">{p.method ?? "—"}</span> },
              { id: "reference", header: "Reference", sortValue: (p) => p.reference ?? "", cell: (p) => <span className="text-muted-foreground">{p.reference ?? "—"}</span> },
              ...(invoiceRows.length > 0 || payments.some((p) => p.invoiceId)
                ? [
                    {
                      id: "invoice",
                      header: "Invoice",
                      sortValue: (p) => invoiceLabel(p.invoiceId) ?? "",
                      // Older payments were recorded before invoices had a status, so
                      // they can be linked here; the balance does not change.
                      cell: (p) =>
                        canLinkPayments && invoiceRows.length > 0 ? (
                          <SelectField
                            value={p.invoiceId && invoiceLabel(p.invoiceId) ? p.invoiceId : NO_INVOICE}
                            onValueChange={(next) => linkPayment(p.id, next)}
                            options={[
                              { value: NO_INVOICE, label: "—" },
                              ...invoiceRows.map((i) => ({ value: i.id, label: i.label })),
                            ]}
                            ariaLabel="Invoice this payment was for"
                            disabled={linking}
                            size="sm"
                            className="h-7 w-32"
                          />
                        ) : (
                          <span className="text-muted-foreground">{invoiceLabel(p.invoiceId) ?? "—"}</span>
                        ),
                    } as Column<BillingPayment>,
                  ]
                : []),
              { id: "by", header: "By", align: "right", cell: (p) => <span className="text-muted-foreground">{p.recordedByName ?? "—"}</span> },
              ...(canManage
                ? [
                    {
                      id: "actions",
                      header: "",
                      align: "right",
                      cell: (p) => (
                        <ConfirmDialog
                          triggerLabel="Void"
                          triggerVariant="ghost"
                          triggerClassName="h-6 px-2 text-xs text-destructive hover:text-destructive"
                          title="Void this entry?"
                          description="The clinic's balance will be recomputed. This can't be undone."
                          confirmLabel="Void"
                          confirmVariant="destructive"
                          onConfirm={async () => {
                            await voidClinicPaymentAction(clinicId, p.id);
                          }}
                        />
                      ),
                    } as Column<BillingPayment>,
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
