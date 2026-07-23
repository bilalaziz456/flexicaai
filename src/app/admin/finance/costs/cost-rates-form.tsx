"use client";

import { useActionState, useState } from "react";
import { saveCostRatesAction, type CostRatesActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

/** Edit the platform unit-cost rates (Owner Finance, Phase 1). Gated by `finance:edit`. */
export function CostRatesForm({
  scribeCallCost,
  whatsappMsgCost,
  whisperMinuteCost,
  claudeInputCost,
  claudeOutputCost,
  usdToPkr,
}: {
  scribeCallCost: number;
  whatsappMsgCost: number;
  whisperMinuteCost: number;
  claudeInputCost: number;
  claudeOutputCost: number;
  usdToPkr: number;
}) {
  const [state, action, pending] = useActionState<CostRatesActionState, FormData>(saveCostRatesAction, {});
  const [scribe, setScribe] = useState(String(scribeCallCost));
  const [wa, setWa] = useState(String(whatsappMsgCost));
  const [whisper, setWhisper] = useState(String(whisperMinuteCost));
  const [claudeIn, setClaudeIn] = useState(String(claudeInputCost));
  const [claudeOut, setClaudeOut] = useState(String(claudeOutputCost));
  const [fx, setFx] = useState(String(usdToPkr));

  const numField = (id: string, label: string, hint: string, value: string, set: (v: string) => void, step = "0.000001") => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="number" step={step} min="0" value={value} onChange={(e) => set(e.target.value)} required />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

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

      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save rates"}</Button>
    </form>
  );
}
