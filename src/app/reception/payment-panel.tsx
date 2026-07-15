"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Printer, Undo2 } from "lucide-react";
import {
  collectPayment,
  applyAppointmentAdvance,
  voidAppointmentPayment,
  issueAppointmentInvoice,
  type BillingActionState,
} from "./payment-actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type LedgerRow = {
  id: string;
  kind: string;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  createdByName: string | null;
  occurredAt: string; // preformatted
};

const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  advance: "Advance",
  advance_applied: "Advance applied",
  refund: "Refund",
};

/**
 * Payment section on the appointment detail — the visible face of the billing
 * ledger. Shows bill / collected / outstanding, a collect form (with apply-advance
 * when the patient has credit), the visit's payment history (void), and invoice
 * issue/print. Gating flags come from the server (ACL); the actions re-check.
 */
export function PaymentPanel({
  appointmentId,
  billTotal,
  collected,
  outstanding,
  paymentStatus,
  credit,
  ledger,
  canCollect,
  canVoidRefund,
  canInvoice,
  invoiceLabel,
  invoiceHref,
}: {
  appointmentId: string;
  billTotal: number;
  collected: number;
  outstanding: number;
  paymentStatus: string;
  credit: number;
  ledger: LedgerRow[];
  canCollect: boolean;
  canVoidRefund: boolean;
  canInvoice: boolean;
  invoiceLabel: string | null;
  /** Reserved for the printable invoice link (next step). */
  invoiceHref?: string;
}) {
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(
    collectPayment.bind(null, appointmentId),
    {},
  );
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);
  const [amount, setAmount] = useState(String(outstanding || ""));

  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [msgNonce, setMsgNonce] = useState(0);
  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setMsgNonce((n) => n + 1);
  };

  const applyCredit = () => {
    const amt = Math.min(credit, outstanding);
    startTransition(async () => {
      const r = await applyAppointmentAdvance(appointmentId, amt);
      flash(r.error ?? "Applied credit.", Boolean(r.error));
    });
  };
  const doVoid = (paymentId: string) =>
    startTransition(async () => {
      const r = await voidAppointmentPayment(appointmentId, paymentId);
      flash(r.error ?? "Voided.", Boolean(r.error));
    });
  const doInvoice = () =>
    startTransition(async () => {
      const r = await issueAppointmentInvoice(appointmentId);
      flash(r.error ?? "Invoice issued.", Boolean(r.error));
    });

  const statusTone =
    paymentStatus === "paid"
      ? "text-emerald-600 dark:text-emerald-400"
      : paymentStatus === "partial"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* Figures */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Bill</div>
          <div className="font-medium tabular-nums">{money.format(billTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Collected</div>
          <div className="font-medium tabular-nums">{money.format(collected)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className={`font-medium tabular-nums ${statusTone}`}>
            {money.format(outstanding)}
          </div>
        </div>
      </div>

      {/* Collect */}
      {canCollect && outstanding > 0 ? (
        <form action={formAction} className="space-y-2 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="pp-amount">Amount (Rs)</label>
              <input
                id="pp-amount"
                name="amount"
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="pp-method">Method</label>
              <select id="pp-method" name="method" defaultValue="cash" className={`${inputCls} select-chevron pr-8`}>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="pp-ref">Reference</label>
              <input id="pp-ref" name="reference" type="text" placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <input type="text" name="note" placeholder="Note (optional)" className={inputCls} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Collect payment"}
            </Button>
            {credit > 0 ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={applyCredit}>
                Apply {money.format(Math.min(credit, outstanding))} credit
              </Button>
            ) : null}
          </div>
          <Toast
            message={state.saved ? "Payment recorded." : state.error ?? null}
            variant={state.error ? "error" : "success"}
            token={nonce}
          />
        </form>
      ) : outstanding <= 0 && billTotal > 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Fully paid.</p>
      ) : null}

      {credit > 0 && outstanding <= 0 ? (
        <p className="text-xs text-muted-foreground">
          Patient has {money.format(credit)} advance credit.
        </p>
      ) : null}

      {/* Invoice: issue a number (assigns INV-N) and/or print (thermal/A5/A4). */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {invoiceLabel ? (
          <span className="text-muted-foreground">
            Invoice <span className="font-medium text-foreground">{invoiceLabel}</span>
          </span>
        ) : canInvoice ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={doInvoice}>
            Issue invoice
          </Button>
        ) : null}
        {invoiceHref ? (
          <Link
            href={invoiceHref}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
          >
            <Printer className="size-3.5" aria-hidden="true" /> Print invoice
          </Link>
        ) : null}
      </div>

      {/* History */}
      {ledger.length > 0 ? (
        <ul className="divide-y rounded-lg border text-sm">
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <span className="font-medium">
                  {KIND_LABEL[e.kind] ?? e.kind}
                  {e.kind === "refund" ? " −" : ""} {money.format(e.amount)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {e.occurredAt}
                  {e.method ? ` · ${e.method}` : ""}
                  {e.reference ? ` · ${e.reference}` : ""}
                  {e.createdByName ? ` · ${e.createdByName}` : ""}
                </span>
              </div>
              {canVoidRefund ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doVoid(e.id)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                >
                  <Undo2 className="size-3" aria-hidden="true" /> Void
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={msgNonce} />
    </div>
  );
}
