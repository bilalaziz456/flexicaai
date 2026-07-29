"use client";

import { useActionState, useState } from "react";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { setClinicPrintPaper, type SettingsActionState } from "./actions";

const PAPERS = [
  { value: "thermal", label: "Thermal", hint: "80mm roll printer" },
  { value: "a5", label: "A5", hint: "148mm sheet" },
  { value: "a4", label: "A4", hint: "210mm sheet" },
];

/**
 * Default print paper size for the clinic — the size every invoice / payment receipt /
 * document print screen opens on. Staff can still switch per-print; this sets the
 * default so they usually don't have to. Saves `clinics.invoice_paper`.
 */
export function PrintingForm({ paper }: { paper: string }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    setClinicPrintPaper,
    {},
  );
  const [sel, setSel] = useState(PAPERS.some((p) => p.value === paper) ? paper : "a4");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="paper" value={sel} />
      <p className="text-sm text-muted-foreground">
        Applies to invoices, payment receipts &amp; other printed documents. Staff can still
        switch the size on any print.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Default paper size">
        {PAPERS.map((p) => {
          const on = sel === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSel(p.value)}
              className={cn(
                "flex min-w-28 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                on ? "border-primary bg-primary/10" : "hover:bg-accent",
              )}
            >
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.hint}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending || sel === paper}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
      {state.saved ? <Toast message="Default paper size saved." /> : null}
    </form>
  );
}
