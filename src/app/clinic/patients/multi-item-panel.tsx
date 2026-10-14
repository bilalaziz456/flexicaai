"use client";

import { useState, useTransition, type ComponentType } from "react";
import { X } from "lucide-react";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import type { ChartItemEditorProps } from "@/core/types/module";
import { recordItemsAction } from "./patient-clinical-actions";

/**
 * Record ONE treatment (or existing condition) on several charted items at once —
 * "extraction on 48, 31 and 45" (owner's ask, 2026-10-15). Core-side and
 * specialty-agnostic, like the single-item panel: it renders the module's editor and
 * hands the keys back untouched. Each item still gets its own dated history entry.
 *
 * The form starts from the items' shared state when they all have the same one, and
 * empty otherwise — copying one tooth's filling onto the rest would be a guess.
 */
export function MultiItemPanel({
  patientId,
  itemKeys,
  sharedCurrent,
  ItemEditor,
  onClear,
  onDone,
}: {
  patientId: string;
  itemKeys: string[];
  sharedCurrent: unknown;
  ItemEditor: ComponentType<ChartItemEditorProps>;
  onClear: () => void;
  onDone: (summary: string) => void;
}) {
  const [draft, setDraft] = useState<unknown>(sharedCurrent ?? null);
  const [asExisting, setAsExisting] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const list = itemKeys.join(", ");

  const save = () =>
    start(async () => {
      setError(null);
      const r = await recordItemsAction(patientId, itemKeys, draft, asExisting ? "existing" : "treatment");
      if ("error" in r) {
        setError(r.error);
        return;
      }
      if (r.failed.length > 0) {
        setError(r.failed.map((f) => `${f.key}: ${f.error}`).join(" · "));
        if (r.recorded.length === 0) return;
      }
      const parts = [
        r.recorded.length ? `Recorded on ${r.recorded.join(", ")}` : null,
        r.skipped.length ? `${r.skipped.join(", ")} already ${r.skipped.length === 1 ? "was" : "were"} like that` : null,
      ].filter(Boolean);
      onDone(parts.join(" · ") || "Nothing changed.");
    });

  return (
    <div className="space-y-2 rounded-lg border well p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {itemKeys.length === 0 ? "Select the teeth on the chart" : `Record on ${itemKeys.length} ${itemKeys.length === 1 ? "tooth" : "teeth"}: ${list}`}
        </p>
        {itemKeys.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={pending}>
            <X className="size-3.5" aria-hidden="true" /> Clear selection
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">Click another tooth to add it; click a selected one again to take it out.</p>
      {itemKeys.length === 0 ? null : (
        <>
          <div className="flex w-fit overflow-hidden rounded-md border well" role="group" aria-label="What kind of record">
            <button
              type="button"
              aria-pressed={!asExisting}
              onClick={() => setAsExisting(false)}
              className={cn("px-3 py-1.5 text-xs font-medium transition-colors", !asExisting ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              Treatment done
            </button>
            <button
              type="button"
              aria-pressed={asExisting}
              onClick={() => setAsExisting(true)}
              className={cn("border-l px-3 py-1.5 text-xs font-medium transition-colors", asExisting ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              Already there
            </button>
          </div>
          <ItemEditor value={draft} onChange={setDraft} disabled={pending} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || draft === null} onClick={save}>
              {pending ? "Saving…" : `${asExisting ? "Save existing condition" : "Record treatment"} on ${itemKeys.length} ${itemKeys.length === 1 ? "tooth" : "teeth"}`}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {asExisting
              ? "Corrects what the patient arrived with, on each selected tooth."
              : "Added to each selected tooth's own history with today's date."}
          </p>
        </>
      )}
      {error ? <p className="text-xs text-destructive-text">{error}</p> : null}
    </div>
  );
}
