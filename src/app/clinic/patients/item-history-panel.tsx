"use client";

import { useEffect, useState, useTransition, type ComponentType } from "react";
import { Loader2, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/core/ui/button";
import type { ChartItemEditorProps, ChartItemHistoryEntry } from "@/core/types/module";
import {
  amendItemAction,
  loadItemHistory,
  recordItemTreatmentAction,
} from "./patient-clinical-actions";

/**
 * One charted item's own history — for dental, everything ever recorded on one tooth.
 *
 * The chart says what a tooth IS; this says how it got there. All of it was already
 * in the per-visit snapshots, but organised by visit, so reading a single tooth's
 * story meant opening every visit in turn.
 *
 * Undo is an AMENDMENT, never a deletion (see the module's `amendItem`): the chart
 * reverts to the state before the chosen entry, and the entry stays here marked as
 * corrected. That is the rule in CLAUDE.md — nothing is erased from a patient's
 * record — and it is also the honest thing to do when a bill or a prescription may
 * already have gone out against that entry.
 *
 * Core-side and specialty-agnostic: it renders whatever `label` the module produced
 * and hands the item key back untouched.
 */
export function ItemHistoryPanel({
  patientId,
  itemKey,
  canAmend,
  current,
  ItemEditor,
  onClose,
  onAmended,
}: {
  patientId: string;
  itemKey: string;
  /** `clinical:edit`. A viewer without it still reads the history, with no Undo. */
  canAmend: boolean;
  /** The item's current state, seeding the treatment form. */
  current?: unknown;
  /** The module's controls for one item. Absent → history only. */
  ItemEditor?: ComponentType<ChartItemEditorProps>;
  onClose: () => void;
  onAmended: () => void;
}) {
  const [entries, setEntries] = useState<ChartItemHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<unknown>(current ?? null);
  const [pending, start] = useTransition();

  // No state reset here: the parent keys this component by item, so choosing a
  // different tooth remounts it and the initial state is already correct.
  useEffect(() => {
    let cancelled = false;
    loadItemHistory(patientId, itemKey)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the history.");
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, itemKey]);

  const amend = (recordId: string) =>
    start(async () => {
      setError(null);
      const r = await amendItemAction(patientId, itemKey, recordId);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onAmended();
      setEntries(await loadItemHistory(patientId, itemKey));
    });

  const record = () =>
    start(async () => {
      setError(null);
      const r = await recordItemTreatmentAction(patientId, itemKey, draft);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setAdding(false);
      onAmended();
      setEntries(await loadItemHistory(patientId, itemKey));
    });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">History of {itemKey}</p>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close history">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {entries === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing has been recorded on {itemKey}.</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((e, i) => (
            <li
              key={`${e.recordId ?? i}-${e.at}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-1.5 text-xs last:border-0 last:pb-0"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                <span className="tabular-nums text-muted-foreground">
                  {new Date(e.at).toLocaleDateString()}
                </span>
                <span className="font-medium">{e.label}</span>
                {e.isBaseline ? (
                  <span className="text-muted-foreground">(existing conditions)</span>
                ) : null}
                {e.isCorrection ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    correction
                  </span>
                ) : null}
              </span>
              {/* A correction is itself an entry, and undoing an undo is a rabbit
                  hole — correct it forward by charting the right value instead. */}
              {canAmend && e.recordId && !e.isCorrection ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => amend(e.recordId!)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Undo<span className="sr-only"> this change to {itemKey}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {/* Record a treatment — its own dated entry, deliberately behind a button.
          If the status controls saved on click, every stray tap would become a line
          in the history, and the history is the thing being built here. */}
      {canAmend && ItemEditor ? (
        adding ? (
          <div className="space-y-2 rounded-md border p-2.5">
            <p className="text-xs font-medium">What was done to {itemKey}?</p>
            <ItemEditor value={draft} onChange={setDraft} disabled={pending} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={record}>
                {pending ? "Saving…" : "Record treatment"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  setDraft(current ?? null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Record treatment
          </Button>
        )
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canAmend && entries && entries.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Undo restores the state before that entry. The entry stays in the history,
          marked as a correction. Nothing is deleted from the record.
        </p>
      ) : null}
    </div>
  );
}
