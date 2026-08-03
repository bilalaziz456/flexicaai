"use client";

import { useActionState, useState } from "react";
import { saveCostRatesAction, type CostRatesActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

/** Edit the platform unit-cost rates (Owner Finance, Phase 1). Gated by `serving_cost:edit`. */
export function CostRatesForm({
  scribeCallCost,
  whatsappMsgCost,
  whisperMinuteCost,
  claudeInputCost,
  claudeOutputCost,
  usdToPkr,
  taxMode,
  foreignTxnFeePct,
  fedPct,
  advanceTaxPct,
  additionalTaxPct,
  totalTaxPct,
}: {
  scribeCallCost: number;
  whatsappMsgCost: number;
  whisperMinuteCost: number;
  claudeInputCost: number;
  claudeOutputCost: number;
  usdToPkr: number;
  taxMode: "itemized" | "total";
  foreignTxnFeePct: number;
  fedPct: number;
  advanceTaxPct: number;
  additionalTaxPct: number;
  totalTaxPct: number;
}) {
  const [state, action, pending] = useActionState<CostRatesActionState, FormData>(saveCostRatesAction, {});
  const [scribe, setScribe] = useState(String(scribeCallCost));
  const [wa, setWa] = useState(String(whatsappMsgCost));
  const [whisper, setWhisper] = useState(String(whisperMinuteCost));
  const [claudeIn, setClaudeIn] = useState(String(claudeInputCost));
  const [claudeOut, setClaudeOut] = useState(String(claudeOutputCost));
  const [fx, setFx] = useState(String(usdToPkr));
  // Bank international-transaction tax/charges.
  const [mode, setMode] = useState<"itemized" | "total">(taxMode);
  const [fee, setFee] = useState(String(foreignTxnFeePct));
  const [fed, setFed] = useState(String(fedPct));
  const [adv, setAdv] = useState(String(advanceTaxPct));
  const [extra, setExtra] = useState(String(additionalTaxPct));
  const [total, setTotal] = useState(String(totalTaxPct));

  const numField = (id: string, label: string, hint: string, value: string, set: (v: string) => void, step = "0.000001") => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="number" step={step} min="0" value={value} onChange={(e) => set(e.target.value)} required />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const effective = mode === "total" ? num(total) : num(fee) + num(fed) + num(adv) + num(extra);

  return (
    <form action={action} className="space-y-5">
      {state.saved ? <Toast message="Cost rates saved." /> : null}

      <div className="space-y-3">
        <div className="text-sm font-medium">Metered rates (accurate — used when a scribe call logs real usage)</div>
        <div className="grid gap-4 sm:grid-cols-3">
          {numField("whisperMinuteCost", "Whisper (USD / audio min)", "OpenAI transcription per minute.", whisper, setWhisper)}
          {numField("claudeInputCost", "Claude input (USD / 1M tokens)", "e.g. 3 for Sonnet.", claudeIn, setClaudeIn, "0.0001")}
          {numField("claudeOutputCost", "Claude output (USD / 1M tokens)", "e.g. 15 for Sonnet.", claudeOut, setClaudeOut, "0.0001")}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium">Fallback / other rates</div>
        <div className="grid gap-4 sm:grid-cols-3">
          {numField("scribeCallCost", "Scribe call estimate (USD)", "Fallback for a visit with no metered usage.", scribe, setScribe)}
          {numField("whatsappMsgCost", "WhatsApp message (USD)", "Per outbound message sent.", wa, setWa)}
          {numField("usdToPkr", "USD → PKR", "Exchange rate to show cost in PKR.", fx, setFx, "0.0001")}
        </div>
      </div>

      {/* International-transaction bank tax / charges */}
      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <div className="text-sm font-medium">Bank tax &amp; charges on international payments</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your bank adds these when you pay the providers in USD (foreign-transaction fee, FED on it, advance tax…).
            Added as a % on top of the serving cost. Read the exact figures off a card/bank statement. All 0 = no charge.
          </p>
        </div>

        {/* Mode selector — the visible fields for the active mode carry the real values;
            the inactive mode's fields are mirrored hidden so nothing is lost on save. */}
        <input type="hidden" name="taxMode" value={mode} />
        <div className="inline-flex rounded-lg border border-input bg-[var(--input-bg)] p-0.5 text-sm">
          {(["itemized", "total"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-md px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "itemized" ? "Itemised" : "Single total %"}
            </button>
          ))}
        </div>

        {mode === "itemized" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {numField("foreignTxnFeePct", "Foreign txn fee (%)", "Bank's fee on the transaction.", fee, setFee, "0.01")}
              {numField("fedPct", "FED (%)", "Federal Excise Duty.", fed, setFed, "0.01")}
              {numField("advanceTaxPct", "Advance tax (%)", "Adjustable against your return.", adv, setAdv, "0.01")}
              {numField("additionalTaxPct", "Additional (%)", "Any other charge.", extra, setExtra, "0.01")}
            </div>
            <input type="hidden" name="totalTaxPct" value={total} />
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {numField("totalTaxPct", "Total tax (%)", "One combined figure from your statement.", total, setTotal, "0.01")}
            </div>
            <input type="hidden" name="foreignTxnFeePct" value={fee} />
            <input type="hidden" name="fedPct" value={fed} />
            <input type="hidden" name="advanceTaxPct" value={adv} />
            <input type="hidden" name="additionalTaxPct" value={extra} />
          </>
        )}

        <p className="text-xs">
          <span className="text-muted-foreground">Effective markup applied: </span>
          <span className="font-medium tabular-nums">{effective}%</span>
        </p>
      </div>

      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save rates"}</Button>
    </form>
  );
}
