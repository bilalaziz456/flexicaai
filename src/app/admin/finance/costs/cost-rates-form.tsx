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
  usdToPkr,
}: {
  scribeCallCost: number;
  whatsappMsgCost: number;
  usdToPkr: number;
}) {
  const [state, action, pending] = useActionState<CostRatesActionState, FormData>(saveCostRatesAction, {});
  const [scribe, setScribe] = useState(String(scribeCallCost));
  const [wa, setWa] = useState(String(whatsappMsgCost));
  const [fx, setFx] = useState(String(usdToPkr));

  return (
    <form action={action} className="space-y-4">
      {state.saved ? <Toast message="Cost rates saved." /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="scribeCallCost">Scribe call (USD)</Label>
          <Input
            id="scribeCallCost"
            name="scribeCallCost"
            type="number"
            step="0.000001"
            min="0"
            value={scribe}
            onChange={(e) => setScribe(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Whisper + Claude, per voice visit.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsappMsgCost">WhatsApp message (USD)</Label>
          <Input
            id="whatsappMsgCost"
            name="whatsappMsgCost"
            type="number"
            step="0.000001"
            min="0"
            value={wa}
            onChange={(e) => setWa(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Per outbound message sent.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="usdToPkr">USD → PKR</Label>
          <Input
            id="usdToPkr"
            name="usdToPkr"
            type="number"
            step="0.0001"
            min="0"
            value={fx}
            onChange={(e) => setFx(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Exchange rate to show cost in PKR.</p>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save rates"}</Button>
    </form>
  );
}
