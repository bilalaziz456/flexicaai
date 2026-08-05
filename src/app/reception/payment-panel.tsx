"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Printer, Undo2 } from "lucide-react";
import {
  collectPayment,
  applyAppointmentAdvance,
  refundAppointmentPayment,
  voidAppointmentPayment,
  issueAppointmentInvoice,
  sendInvoiceWhatsAppAction,
  type BillingActionState,
} from "./payment-actions";
import { Button, buttonVariants } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { MessageCircle } from "lucide-react";

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
 * when the patient has credit), a refund form, the visit's payment history (void),
 * and invoice issue/print. Gating flags come from the server (ACL); the actions
 * re-check. `canRefund` = issue a refund; `canVoidPayment` = void a payment/advance;
 * `canVoidRefundEntry` = reverse a refund entry (all independently grantable).
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
  canRefund,
  canVoidPayment,
  canVoidRefundEntry,
  canInvoice,
  canSendWhatsapp,
  invoiceLabel,
  invoiceHref,
  receiptHref,
}: {
  appointmentId: string;
  billTotal: number;
  collected: number;
  outstanding: number;
  paymentStatus: string;
  credit: number;
  ledger: LedgerRow[];
  canCollect: boolean;
  canRefund: boolean;
  canVoidPayment: boolean;
  canVoidRefundEntry: boolean;
  canInvoice: boolean;
  canSendWhatsapp: boolean;
  invoiceLabel: string | null;
  /** Reserved for the printable invoice link (next step). */
  invoiceHref?: string;
  /** Printable payment receipt link (shown once money has been collected). */
  receiptHref?: string;
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

  // Refund form (collapsed by default; only offered when there's money to give back).
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundState, refundAction, refundPending] = useActionState<BillingActionState, FormData>(
    refundAppointmentPayment.bind(null, appointmentId),
    {},
  );
  const [refundNonce, setRefundNonce] = useState(0);
  useEffect(() => {
    if (refundState.saved || refundState.error) setRefundNonce((n) => n + 1);
    if (refundState.saved) setRefundOpen(false);
  }, [refundState]);

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
  const doSendWhatsapp = () =>
    startTransition(async () => {
      const r = await sendInvoiceWhatsAppAction(appointmentId);
      flash(r.error ?? "Invoice sent on WhatsApp.", Boolean(r.error));
    });

  const statusTone =
    paymentStatus === "paid"
      ? "text-success-text"
      : paymentStatus === "partial"
        ? "text-warning-text"
        : "text-muted-foreground";

  // A visit that isn't completed yet has no real bill/receivable — its total is an
  // estimate and any money taken is a deposit (held until the visit is completed).
  const notBilled = paymentStatus === "not_billed";

  return (
    <div className="space-y-4">
      {/* Figures */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">{notBilled ? "Estimated total" : "Bill"}</div>
          <div className="font-medium tabular-nums">{money.format(billTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{notBilled ? "Deposit paid" : "Collected"}</div>
          <div className="font-medium tabular-nums">{money.format(collected)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{notBilled ? "Est. balance" : "Outstanding"}</div>
          <div className={`font-medium tabular-nums ${statusTone}`}>
            {money.format(outstanding)}
          </div>
        </div>
      </div>

      {notBilled ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          This visit isn&apos;t completed yet, so the total is an estimate and anything
          paid is a <strong>deposit</strong>. It only counts as revenue — and the
          balance only becomes a receivable — once the visit is marked completed.
        </p>
      ) : null}

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
        <p className="text-sm text-success-text">Fully paid.</p>
      ) : null}

      {credit > 0 && outstanding <= 0 ? (
        <p className="text-xs text-muted-foreground">
          Patient has {money.format(credit)} advance credit.
        </p>
      ) : null}

      {/* Refund: give back money already collected on this visit. */}
      {canRefund && collected > 0 ? (
        refundOpen ? (
          <form action={refundAction} className="space-y-2 rounded-lg border border-destructive/40 p-3">
            <p className="text-xs font-medium text-destructive">
              Refund from {money.format(collected)} collected
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="rf-amount">Amount (Rs)</label>
                <input
                  id="rf-amount"
                  name="amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={collected}
                  defaultValue={String(collected)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="rf-method">Method</label>
                <select id="rf-method" name="method" defaultValue="cash" className={`${inputCls} select-chevron pr-8`}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="rf-ref">Reference</label>
                <input id="rf-ref" name="reference" type="text" placeholder="Optional" className={inputCls} />
              </div>
            </div>
            <input type="text" name="note" placeholder="Reason (optional)" className={inputCls} />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={refundPending}>
                {refundPending ? "Refunding…" : "Confirm refund"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={refundPending} onClick={() => setRefundOpen(false)}>
                Cancel
              </Button>
            </div>
            <Toast
              message={refundState.saved ? "Refund recorded." : refundState.error ?? null}
              variant={refundState.error ? "error" : "success"}
              token={refundNonce}
            />
          </form>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setRefundOpen(true)}>
            Refund…
          </Button>
        )
      ) : null}

      {/* Invoice / receipt: create a number + print (thermal/A5/A4), all as
          consistent buttons so it's clear each is a clickable action. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {invoiceLabel ? (
            <span className="text-muted-foreground">
              Invoice <span className="font-medium text-foreground">{invoiceLabel}</span>
            </span>
          ) : canInvoice ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={doInvoice}>
              Create invoice #
            </Button>
          ) : null}
          {invoiceHref ? (
            <Link
              href={invoiceHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Printer className="size-3.5" aria-hidden="true" /> Print bill
            </Link>
          ) : null}
          {receiptHref && collected > 0 ? (
            <Link
              href={receiptHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Printer className="size-3.5" aria-hidden="true" /> Print receipt
            </Link>
          ) : null}
          {canSendWhatsapp && billTotal > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={doSendWhatsapp}
            >
              <MessageCircle className="size-3.5" aria-hidden="true" /> Send on WhatsApp
            </Button>
          ) : null}
        </div>
        {invoiceHref ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Bill</span> = what the patient owes ·{" "}
            <span className="font-medium">Receipt</span> = proof of payment
            {collected > 0 ? "" : " (available once money is collected)"}.
          </p>
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
              {(e.kind === "refund" ? canVoidRefundEntry : canVoidPayment) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doVoid(e.id)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                >
                  <Undo2 className="size-3" aria-hidden="true" />{" "}
                  {e.kind === "refund" ? "Reverse" : "Void"}
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
