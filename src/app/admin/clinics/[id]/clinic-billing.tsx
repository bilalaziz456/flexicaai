"use client";

import { useActionState, useState, useTransition } from "react";
import {
  recordClinicPaymentAction,
  setClinicPrice,
  setPaymentNoticeEnabledAction,
  setPaymentReminderDaysAction,
  voidClinicPaymentAction,
  type AdminActionState,
} from "@/app/admin/actions";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DataTable, type Column } from "@/core/ui/data-table";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);
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
};

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
  // Clinic-facing payment-due notice toggle (optimistic; reverts on error).
  const [noticeOn, setNoticeOn] = useState(paymentNoticeEnabled);
  const [togglingNotice, startNotice] = useTransition();
  const [noticeErr, setNoticeErr] = useState<string | null>(null);
  const toggleNotice = () => {
    const next = !noticeOn;
    setNoticeOn(next);
    setNoticeErr(null);
    startNotice(async () => {
      const r = await setPaymentNoticeEnabledAction(clinicId, next);
      if (r.error) {
        setNoticeOn(!next);
        setNoticeErr(r.error);
      }
    });
  };
  // "Payment coming up" reminder window (days before the paid-through date). Saves on
  // blur; reverts to the last saved value on error.
  const [reminderVal, setReminderVal] = useState(String(paymentReminderDays));
  const [savedReminder, setSavedReminder] = useState(paymentReminderDays);
  const [savingReminder, startReminder] = useTransition();
  const [reminderErr, setReminderErr] = useState<string | null>(null);
  const [reminderOk, setReminderOk] = useState(false);
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
        setReminderOk(true);
        setTimeout(() => setReminderOk(false), 2000);
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
      {priceState.saved ? <Toast message="Billing settings saved." /> : null}
      {payState.saved ? <Toast message="Recorded." /> : null}

      {/* ---- Balance summary ---- */}
      <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="mt-1"><StatusBadge s={balance.billingStatus} /></div>
        </div>
        <div>
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
        <div>
          <div className="text-xs text-muted-foreground">
            {balance.credit > 0 ? "Credit (paid ahead)" : "Owed (remaining)"}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              balance.owed > 0 ? "text-destructive" : balance.credit > 0 ? "text-emerald-600" : "",
            )}
          >
            {rs(balance.credit > 0 ? balance.credit : balance.owed)}
          </div>
          {balance.billingStatus !== "free" ? (
            <div className="text-xs text-muted-foreground">billed {rs(balance.accrued)}</div>
          ) : null}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total collected</div>
          <div className="mt-1 text-sm font-medium">{rs(balance.totalPaid)}</div>
          <div className="text-xs text-muted-foreground">{balance.monthsPaid} months paid</div>
        </div>
      </div>

      {/* Clinic-facing payment-due notice toggle (owner/super-admin/account manager). */}
      {canToggleNotice && monthlyPrice > 0 ? (
        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Show payment-due notice to clinic staff</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When on, every user in this clinic sees a due/overdue reminder in their workspace.
              Turn it off to stop reminding (e.g. a clinic on a payment plan). This does not affect
              the dues dashboard or the hard past-due lock.
            </p>
            {noticeErr ? <p className="mt-1 text-xs text-destructive" role="alert">{noticeErr}</p> : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={noticeOn}
            aria-label="Show payment-due notice to clinic staff"
            disabled={togglingNotice}
            onClick={toggleNotice}
            className={cn(
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
              noticeOn ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 rounded-full bg-white shadow transition-transform",
                noticeOn ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      ) : null}

      {/* "Payment coming up" reminder window (owner/super-admin/account manager). Shown
          regardless of price for discoverability; it only takes effect once a price is set. */}
      {canToggleNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
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
            ) : reminderOk ? (
              <span className="text-xs text-success-text">Saved</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Follow-up commitment on an outstanding balance. */}
      {commitmentAt && balance.owed > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
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

      {/* ---- Price / cycle / grace (manage only) ---- */}
      {canManage ? (
      <form action={priceAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="monthlyPrice">Monthly price (PKR)</Label>
            <Input id="monthlyPrice" name="monthlyPrice" type="number" min={0} value={priceVal} onChange={(e) => setPriceVal(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingCycle">Expected cycle</Label>
            <select id="billingCycle" name="billingCycle" defaultValue={billingCycle} className={selectClass}>
              {CYCLES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
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
      </form>
      ) : null}

      {/* ---- Record a payment (manage only) ---- */}
      {canManage ? (
      <form action={payAction} className="space-y-3 rounded-md border p-4">
        <input type="hidden" name="kind" value={kind} />
        <div className="text-sm font-medium">Record payment / refund / credit</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="kind">Type</Label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
              <option value="payment">Payment (money in)</option>
              <option value="refund">Refund (money out)</option>
              <option value="credit">Credit (non-cash adjustment)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (PKR)</Label>
            <Input id="amount" name="amount" type="number" min={1} required />
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
            <select id="method" name="method" defaultValue="bank" className={selectClass}>
              {methodOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="occurredAt">Date</Label>
            <Input id="occurredAt" name="occurredAt" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" placeholder="Txn / cheque no." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Input id="note" name="note" />
          </div>
        </div>

        {/* Follow-up on any remaining balance (payment only). */}
        {isPayment ? (
          <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="commitmentAt">Follow-up date (if balance remains)</Label>
              <Input id="commitmentAt" name="commitmentAt" type="date" />
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
      </form>
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
