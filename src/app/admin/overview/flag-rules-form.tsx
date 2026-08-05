"use client";

import { useActionState } from "react";
import { setAnomalyThresholdsAction, type OverviewActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

/**
 * Company-wide anomaly flag rules (Overview). Full-admin only. Tunes when a clinic
 * gets flagged: High cost (serving cost ≥ N% of MRR) and Usage spike (≥ N× the prior
 * period, ignoring costs below a floor). The "Cost > MRR" loss flag is definitional
 * and not tunable.
 */
export function FlagRulesForm({
  thinMarginPct,
  spikeMultiple,
  spikeFloorPkr,
}: {
  thinMarginPct: number;
  spikeMultiple: number;
  spikeFloorPkr: number;
}) {
  const [state, action, pending] = useActionState<OverviewActionState, FormData>(setAnomalyThresholdsAction, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="thinMarginPct" className="text-xs text-muted-foreground">High cost: serving cost ≥ (% of MRR)</Label>
        <Input id="thinMarginPct" name="thinMarginPct" type="number" min={1} max={100} defaultValue={thinMarginPct} className="h-8 w-28" key={`t${thinMarginPct}`} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="spikeMultiple" className="text-xs text-muted-foreground">Usage spike: ≥ (× prior period)</Label>
        <Input id="spikeMultiple" name="spikeMultiple" type="number" min={2} max={100} defaultValue={spikeMultiple} className="h-8 w-28" key={`m${spikeMultiple}`} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="spikeFloorPkr" className="text-xs text-muted-foreground">Spike floor: ignore below (Rs)</Label>
        <Input id="spikeFloorPkr" name="spikeFloorPkr" type="number" min={0} defaultValue={spikeFloorPkr} className="h-8 w-32" key={`f${spikeFloorPkr}`} />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? "Saving…" : "Save flag rules"}</Button>
      <Toast message={state.saved ? "Flag rules saved." : state.error ?? null} variant={state.error ? "error" : "success"} token={state.saved ? 1 : state.error ? 2 : 0} />
    </form>
  );
}
