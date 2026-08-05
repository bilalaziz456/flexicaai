import { AlertTriangle } from "lucide-react";

/**
 * Clinic-facing subscription payment notice — a bottom-centre pill matching the
 * connectivity ({@link ConnectionStatus}) style, shown to every clinic user while the
 * subscription is DUE (amber) or OVERDUE (red) but the workspace is still usable.
 * Rendered by the clinic shell only when `clinics.payment_notice_enabled` is on; the
 * super-admin / account manager can switch it off per clinic. Positioning is owned by
 * the PanelShell bottom-pill stack (it sits directly above the connectivity pill) — so
 * this returns just the pill. No amount is shown — it's a nudge, not an invoice.
 */
export function PaymentNoticePill({ status }: { status: "due" | "overdue" }) {
  const overdue = status === "overdue";
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex max-w-[92vw] items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg " +
        (overdue ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-amber-950")
      }
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      {overdue ? (
        <span>
          <span className="font-semibold">Payment overdue</span>: access may be suspended soon.
        </span>
      ) : (
        <span>
          <span className="font-semibold">Payment due</span>: please settle your subscription to
          avoid interruption.
        </span>
      )}
    </div>
  );
}
