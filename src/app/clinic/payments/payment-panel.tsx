"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, Undo2 } from "lucide-react";
import {
  collectPayment,
  applyAppointmentAdvance,
  keepExtraAsCredit,
  refundAppointmentPayment,
  voidAppointmentPayment,
  issueAppointmentInvoice,
  sendInvoiceWhatsAppAction,
  type BillingActionState,
} from "@/app/clinic/payments/payment-actions";
import { SelectField } from "@/core/ui/select-field";
import { Button, buttonVariants } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Toast, toast, useActionToast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { MessageCircle } from "lucide-react";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";
import { DownloadLink } from "@/core/ui/download-link";

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
  extra = 0,
  canKeepAsCredit = false,
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
  /** Money held beyond the bill — a deposit bigger than the final charges, or all of
   *  it on a cancelled visit. Settled by a refund or by keeping it as credit. */
  extra?: number;
  /** May move the extra to the patient's credit (`billing:edit`). */
  canKeepAsCredit?: boolean;
}) {
  // Labels come from the database (ADR-027); read once, since a hook cannot run
  // inside a cell or map callback.
  const kindLabels = useVocabulary("payment_kinds");
  // Methods come from the database (ADR-027): active only, in its own order.
  const methodOptions = useTenderOptions();
  const router = useRouter();
  // Two submit buttons share this form; the one that says `then=print` goes on to
  // the bill once the money is recorded. That happens HERE, in the action, so it
  // follows the save rather than an effect watching for it (conventions §5) — and
  // only on success, so a rejected amount never sends anyone to print a bill.
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(
    async (prev, fd) => {
      const res = await collectPayment(appointmentId, prev, fd);
      if (res.saved && fd.get("then") === "print" && invoiceHref) {
        // Toasted here rather than via `useActionToast`, whose component is about to
        // unmount; the toast host lives in the root layout, so it survives the move.
        toast.success(res.confirmed ? "Payment received · appointment confirmed." : "Payment received.");
        router.push(invoiceHref);
        return {};
      }
      return res;
    },
    {},
  );
  useActionToast(state, {
    saved: state.confirmed ? "Payment received · appointment confirmed." : "Payment received.",
    error: true,
  });
  const [amount, setAmount] = useState(String(outstanding || ""));

  // Refund form (collapsed by default; only offered when there's money to give back).
  const [refundOpen, setRefundOpen] = useState(false);
  // Collapsing the form again is what a successful refund DOES, so it happens in the
  // action. As an effect on `refundState` it also reopened nothing: the flag stays
  // true, so a second refund found the panel already closed and never reacted.
  const [refundState, refundAction, refundPending] = useActionState<BillingActionState, FormData>(
    async (prev, fd) => {
      const res = await refundAppointmentPayment(appointmentId, prev, fd);
      if (res.saved) setRefundOpen(false);
      return res;
    },
    {},
  );
  useActionToast(refundState, { saved: "Refund recorded.", error: true });

  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [msgNonce, setMsgNonce] = useState(0);
  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setMsgNonce((n) => n + 1);
  };

  // Settle, the "less than the deposit" half: keep the extra for a later visit.
  const doKeepAsCredit = async () => {
    const r = await keepExtraAsCredit(appointmentId);
    if (r.error) return { error: r.error };
    flash(`${money.format(extra)} kept as credit for the patient.`);
  };
  const applyCredit = () => {
    const amt = Math.min(credit, outstanding);
    startTransition(async () => {
      const r = await applyAppointmentAdvance(appointmentId, amt);
      flash(r.error ?? "Applied credit.", Boolean(r.error));
    });
  };
  // Runs from the confirm dialog: an error keeps the dialog open and is shown there.
  const doVoid = async (paymentId: string, isRefund: boolean) => {
    const r = await voidAppointmentPayment(appointmentId, paymentId);
    if (r.error) return { error: r.error };
    flash(isRefund ? "Refund cancelled." : "Payment cancelled.");
  };
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
        {extra > 0 ? (
          <div>
            <div className="text-xs text-muted-foreground">Extra held</div>
            <div className="font-medium tabular-nums text-warning-text">{money.format(extra)}</div>
          </div>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className={`font-medium tabular-nums ${statusTone}`}>
              {money.format(outstanding)}
            </div>
          </div>
        )}
      </div>

      {/* Collect */}
      {canCollect && outstanding > 0 ? (
        <ActionForm action={formAction} state={state} className="space-y-2 rounded-lg border well p-3">
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
              <SelectField
                id="pp-method"
                name="method"
                defaultValue="cash"
                options={[...methodOptions.map((m) => ({ value: m.value, label: m.label }))]}
                ariaLabel="method"
                className="h-8 w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="pp-ref">Reference</label>
              <input id="pp-ref" name="reference" type="text" placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <input type="text" name="note" aria-label="Note for this payment" placeholder="Note (optional)" className={inputCls} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "Saving…" : "Save payment"}
            </Button>
            {invoiceHref ? (
              <Button
                type="submit"
                name="then"
                value="print"
                size="sm"
                disabled={pending}
              >
                <Printer className="size-3.5" aria-hidden="true" /> Save &amp; print invoice
              </Button>
            ) : null}
            {credit > 0 ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={applyCredit}>
                Apply {money.format(Math.min(credit, outstanding))} credit
              </Button>
            ) : null}
          </div>
        </ActionForm>
      ) : extra > 0 ? (
        // Settle: more was taken than the bill came to (a deposit at admission, say).
        // The extra is given back or kept for the next visit — never left unexplained.
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>
            <span className="font-medium">{money.format(extra)} extra</span> is held on this visit
            {billTotal > 0 ? ` — the patient paid ${money.format(collected)} against a bill of ${money.format(billTotal)}` : ""}.
            Refund it, or keep it as credit for the next visit.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canRefund ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setRefundOpen(true)}>
                Refund {money.format(extra)}
              </Button>
            ) : null}
            {canKeepAsCredit ? (
              <ConfirmDialog
                triggerLabel="Keep as credit"
                triggerVariant="outline"
                title={`Keep ${money.format(extra)} as credit?`}
                description="It moves from this visit to the patient's credit, ready to apply to their next visit. No cash changes hands."
                confirmLabel="Keep as credit"
                onConfirm={doKeepAsCredit}
              />
            ) : null}
          </div>
        </div>
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
          <ActionForm action={refundAction} state={refundState} className="space-y-2 rounded-lg border border-destructive/40 well p-3">
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
                  defaultValue={String(extra > 0 ? extra : collected)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="rf-method">Method</label>
                <SelectField
                  id="rf-method"
                  name="method"
                  defaultValue="cash"
                  options={[...methodOptions.map((m) => ({ value: m.value, label: m.label }))]}
                  ariaLabel="method"
                  className="h-8 w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="rf-ref">Reference</label>
                <input id="rf-ref" name="reference" type="text" placeholder="Optional" className={inputCls} />
              </div>
            </div>
            <input type="text" name="note" aria-label="Reason for this refund" placeholder="Reason (optional)" className={inputCls} />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={refundPending}>
                {refundPending ? "Refunding…" : "Confirm refund"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={refundPending} onClick={() => setRefundOpen(false)}>
                Cancel
              </Button>
            </div>
          </ActionForm>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setRefundOpen(true)}>
            Refund…
          </Button>
        )
      ) : null}

      {/* Invoice: create a number + print (thermal/A5/A4), all as
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
            <span className="inline-flex items-center gap-2">
            <Link
              href={invoiceHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Printer className="size-3.5" aria-hidden="true" /> Print invoice
            </Link>
            <DownloadLink
              href={invoiceHref}
              label="Download invoice"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            />
            </span>
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
          // ONE paper for the patient (owner's call, 2026-10-12): the invoice shows the
          // bill, every payment and refund, and what is still due — there is no
          // separate receipt to choose between.
          <p className="text-xs text-muted-foreground">
            The invoice is what the patient takes: it shows the bill, every payment and the balance due.
          </p>
        ) : null}
      </div>

      {/* History */}
      {ledger.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-sm">
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <span className="font-medium">
                  {labelFrom(kindLabels, e.kind)}
                  {e.kind === "refund" ? " −" : ""} {money.format(e.amount)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {e.occurredAt}
                  {e.method ? ` · ${e.method}` : ""}
                  {e.reference ? ` · ${e.reference}` : ""}
                  {e.createdByName ? ` · ${e.createdByName}` : ""}
                </span>
                {/* The refund form asks for a REASON and every form asks for a note;
                    both are stored here, so they have to be shown here. */}
                {e.note ? (
                  <span className="block text-xs text-muted-foreground">
                    {e.kind === "refund" ? "Reason" : "Note"}: {e.note}
                  </span>
                ) : null}
              </div>
              {(e.kind === "refund" ? canVoidRefundEntry : canVoidPayment) ? (
                // Plain words, owner's call: "Void" read as jargon. This REMOVES an
                // entry recorded by mistake — no money moves — which is not a refund
                // (money handed back), so the dialog says which one it is. Confirmed
                // first: one stray click used to take a real payment off the bill.
                <ConfirmDialog
                  triggerLabel={e.kind === "refund" ? "Cancel refund" : "Cancel payment"}
                  triggerIcon={<Undo2 aria-hidden="true" />}
                  triggerVariant="ghost"
                  triggerClassName="shrink-0 text-destructive hover:text-destructive"
                  triggerDisabled={busy}
                  title={
                    e.kind === "refund"
                      ? `Cancel this refund of ${money.format(e.amount)}?`
                      : `Cancel this payment of ${money.format(e.amount)}?`
                  }
                  description={
                    e.kind === "refund"
                      ? "Use this only if the refund was recorded by mistake. It is removed from the bill, so the money counts as collected again."
                      : "Use this only if the payment was recorded by mistake. It is removed from the bill and the amount becomes outstanding again. To give money back to the patient, use Refund instead."
                  }
                  confirmLabel={e.kind === "refund" ? "Cancel refund" : "Cancel payment"}
                  confirmVariant="destructive"
                  cancelLabel={e.kind === "refund" ? "Keep refund" : "Keep payment"}
                  onConfirm={() => doVoid(e.id, e.kind === "refund")}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={msgNonce} />
    </div>
  );
}
