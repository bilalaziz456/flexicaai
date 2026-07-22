"use client";

import { useActionState, useTransition } from "react";
import {
  recordClinicPaymentAction,
  setClinicPrice,
  voidClinicPaymentAction,
  type AdminActionState,
} from "@/app/admin/actions";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
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
  owed: number;
  daysRemaining: number;
  daysOverdue: number;
};
export type BillingPayment = {
  id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  monthsCovered: number;
  note: string | null;
  occurredAt: string;
  recordedByName: string | null;
};

function StatusBadge({ s }: { s: BillingBalance["billingStatus"] }) {
  const map = {
    active: ["Active", "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"],
    due: ["Due", "bg-amber-500/10 text-amber-600 dark:text-amber-400"],
    overdue: ["Overdue", "bg-destructive/10 text-destructive"],
    free: ["Free", "bg-secondary text-secondary-foreground"],
  } as const;
  const [label, tone] = map[s];
  return <Badge variant="outline" className={cn("border-transparent", tone)}>{label}</Badge>;
}

export function ClinicBilling({
  clinicId,
  monthlyPrice,
  billingCycle,
  graceDays,
  balance,
  payments,
  canManage = true,
}: {
  clinicId: string;
  monthlyPrice: number;
  billingCycle: string;
  graceDays: number;
  balance: BillingBalance;
  payments: BillingPayment[];
  /** False = read-only (billing:view): show status + history, hide the edit forms. */
  canManage?: boolean;
}) {
  const [priceState, priceAction, savingPrice] = useActionState<AdminActionState, FormData>(
    setClinicPrice.bind(null, clinicId),
    {},
  );
  const [payState, payAction, paying] = useActionState<AdminActionState, FormData>(
    recordClinicPaymentAction.bind(null, clinicId),
    {},
  );
  const [voiding, startVoid] = useTransition();

  return (
    <div className="space-y-6">
      {priceState.saved ? <Toast message="Billing settings saved." /> : null}
      {payState.saved ? <Toast message="Payment recorded." /> : null}

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
          <div className="text-xs text-muted-foreground">Owed (carried forward)</div>
          <div className={cn("mt-1 text-sm font-semibold", balance.owed > 0 ? "text-destructive" : "")}>
            {rs(balance.owed)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total collected</div>
          <div className="mt-1 text-sm font-medium">{rs(balance.totalPaid)}</div>
          <div className="text-xs text-muted-foreground">{balance.monthsPaid} months paid</div>
        </div>
      </div>

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Read-only — you can see billing status but not change price or record payments.
        </p>
      ) : null}

      {/* ---- Price / cycle / grace (manage only) ---- */}
      {canManage ? (
      <form action={priceAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="monthlyPrice">Monthly price (PKR)</Label>
            <Input id="monthlyPrice" name="monthlyPrice" type="number" min={0} defaultValue={monthlyPrice} />
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
            <Input id="graceDays" name="graceDays" type="number" min={0} defaultValue={graceDays} />
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
        <div className="text-sm font-medium">Record a payment</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (PKR)</Label>
            <Input id="amount" name="amount" type="number" min={1} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthsCovered">Months covered</Label>
            <Input id="monthsCovered" name="monthsCovered" type="number" min={0} max={120} defaultValue={1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method</Label>
            <select id="method" name="method" defaultValue="bank" className={selectClass}>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
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
        {payState.error ? <p className="text-sm text-destructive" role="alert">{payState.error}</p> : null}
        <Button type="submit" disabled={paying}>{paying ? "Recording…" : "Record payment"}</Button>
      </form>
      ) : null}

      {/* ---- History ---- */}
      {payments.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">Payment history</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-normal">Date</th>
                  <th className="py-1.5 font-normal">Amount</th>
                  <th className="py-1.5 font-normal">Months</th>
                  <th className="py-1.5 font-normal">Method</th>
                  <th className="py-1.5 font-normal">Reference</th>
                  <th className="py-1.5 text-right font-normal">By</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5">{fmtDate(p.occurredAt)}</td>
                    <td className="py-1.5 font-medium">{rs(p.amount)}</td>
                    <td className="py-1.5">{p.monthsCovered}</td>
                    <td className="py-1.5 capitalize">{p.method ?? "—"}</td>
                    <td className="py-1.5 text-muted-foreground">{p.reference ?? "—"}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{p.recordedByName ?? "—"}</td>
                    <td className="py-1.5 text-right">
                      {canManage ? (
                        <button
                          type="button"
                          disabled={voiding}
                          onClick={() => {
                            if (confirm("Void this payment? Paid-through will shrink.")) {
                              startVoid(async () => {
                                await voidClinicPaymentAction(clinicId, p.id);
                              });
                            }
                          }}
                          className="text-xs text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
