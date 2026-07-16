"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { recordSettlement, voidSettlement, type PayoutActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const SETTLEMENT_LABEL: Record<string, string> = {
  doctor_waive: "Doctor waived own share",
  clinic_waive: "Clinic waived (forgave debt)",
  write_off: "Debt written off",
  repayment: "Doctor repayment",
};

/**
 * Record a settlement action on a doctor's balance. The available kinds depend on
 * which way the balance leans and the viewer's rights: a doctor who is OWED can have
 * his share waived (by himself or a `share_waive` holder); a doctor who OWES can be
 * relieved by the clinic (waive / write-off) or repay it (all `share_waive`).
 */
export function SettlementForm({
  doctorId,
  outstanding,
  canClinic,
  canDoctorWaive,
}: {
  doctorId: string;
  outstanding: number;
  canClinic: boolean;
  canDoctorWaive: boolean;
}) {
  const owedToDoctor = Math.max(0, outstanding);
  const owedByDoctor = Math.max(0, -outstanding);

  const options = useMemo(() => {
    const o: { value: string; label: string; max: number }[] = [];
    if (owedToDoctor > 0 && canDoctorWaive) o.push({ value: "doctor_waive", label: "Doctor waives own share", max: owedToDoctor });
    if (owedByDoctor > 0 && canClinic) {
      o.push({ value: "clinic_waive", label: "Clinic waives (forgive debt)", max: owedByDoctor });
      o.push({ value: "write_off", label: "Write off debt", max: owedByDoctor });
      o.push({ value: "repayment", label: "Doctor repayment", max: owedByDoctor });
    }
    return o;
  }, [owedToDoctor, owedByDoctor, canClinic, canDoctorWaive]);

  const [state, formAction, pending] = useActionState<PayoutActionState, FormData>(recordSettlement, {});
  const [nonce, setNonce] = useState(0);
  const [kind, setKind] = useState(options[0]?.value ?? "");
  const max = options.find((o) => o.value === kind)?.max ?? 0;
  const [amount, setAmount] = useState(String(max || ""));

  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);

  if (options.length === 0) return null;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="doctorId" value={doctorId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="st-kind">Action</label>
          <select
            id="st-kind"
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setAmount(String(options.find((o) => o.value === e.target.value)?.max ?? ""));
            }}
            className={`${inputCls} select-chevron pr-8`}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="st-amount">
            Amount (Rs) — up to {money.format(max)}
          </label>
          <input
            id="st-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className={inputCls}
          />
        </div>
      </div>
      <input type="text" name="note" placeholder="Note (optional)" className={inputCls} />
      <Button type="submit" disabled={pending || Number(amount) <= 0 || Number(amount) > max}>
        {pending ? "Recording…" : "Record"}
      </Button>
      <Toast
        message={state.saved ? "Recorded." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}

/** Reverse a settlement action (the balance moves back). Needs `share_waive`. */
export function VoidSettlementButton({ actionId }: { actionId: string }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await voidSettlement(actionId);
            if (r.error) {
              setErr(r.error);
              setNonce((n) => n + 1);
            }
          })
        }
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        <Undo2 className="size-3" aria-hidden="true" /> Reverse
      </button>
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}
