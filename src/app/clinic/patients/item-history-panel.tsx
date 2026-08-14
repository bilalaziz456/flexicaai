"use client";

import { useEffect, useState, useTransition, type ComponentType } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/core/ui/button";
import type { ChartItemEditorProps, ChartItemHistoryEntry } from "@/core/types/module";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { cn } from "@/core/lib/utils";
import {
  deleteItemRecordAction,
  editItemRecordAction,
  loadItemHistory,
  recordItemTreatmentAction,
  setItemBaselineAction,
} from "./patient-clinical-actions";

/**
 * One charted item's own history — for dental, everything ever recorded on one tooth.
 *
 * The chart says what a tooth IS; this says how it got there. All of it was already
 * in the per-visit snapshots, but organised by visit, so reading a single tooth's
 * story meant opening every visit in turn.
 *
 * Newest first, because the question asked of a chart is almost always what happened
 * recently, and the item on the chart shows the latest entry.
 *
 * A recorded treatment can be EDITED in place or DELETED. Deleting soft-deletes the
 * record and re-folds, so the item reverts to what the remaining records say and
 * nothing is erased — it moves to Trash and can be restored. Entries that came from a
 * visit are read-only here: they belong to a clinical note a doctor approved, and
 * changing one from an item panel would alter a signed record without anyone opening
 * the visit.
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
  const [asExisting, setAsExisting] = useState(false);
  const [editRow, setEditRow] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<unknown>(null);
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

  const refresh = async () => setEntries(await loadItemHistory(patientId, itemKey));

  const saveEdit = (recordId: string) =>
    start(async () => {
      setError(null);
      const r = await editItemRecordAction(patientId, itemKey, recordId, editDraft);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setEditRow(null);
      onAmended();
      await refresh();
    });

  /**
   * Returns the error to ConfirmDialog rather than throwing, so a refusal — a visit's
   * entry, or one already gone — keeps the dialog open and says why.
   */
  const remove = async (recordId: string) => {
    const r = await deleteItemRecordAction(patientId, itemKey, recordId);
    if ("error" in r) return { error: r.error };
    onAmended();
    await refresh();
  };

  const record = () =>
    start(async () => {
      setError(null);
      const r = asExisting
        ? await setItemBaselineAction(patientId, itemKey, draft)
        : await recordItemTreatmentAction(patientId, itemKey, draft);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setAdding(false);
      onAmended();
      await refresh();
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
          {entries.map((e, i) => {
            const editing = editRow === e.recordId;
            // Only a recorded treatment may be changed from here. A visit's entry
            // belongs to a clinical note a doctor approved, and the baseline is the
            // intake snapshot — each has its own door.
            const mine = canAmend && e.recordId && e.source === "treatment";
            return (
              <li key={`${e.recordId ?? i}-${e.at}`} className="border-b pb-1.5 text-xs last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                    <span className="tabular-nums text-muted-foreground">
                      {new Date(e.at).toLocaleDateString()}
                    </span>
                    <span className="font-medium">{e.label}</span>
                    {e.source === "baseline" ? (
                      <span className="text-muted-foreground">(existing conditions)</span>
                    ) : null}
                    {e.source === "visit" ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        from a visit
                      </span>
                    ) : null}
                  </span>
                  {mine && !editing ? (
                    <span className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setEditRow(e.recordId);
                          setEditDraft(e.state ?? null);
                          setError(null);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit<span className="sr-only"> this entry on {itemKey}</span>
                      </Button>
                      <ConfirmDialog
                        triggerLabel={`Delete this entry on ${itemKey}`}
                        triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                        triggerVariant="ghost"
                        // The app's delete red. `destructive-text` is the contrast-corrected
                        // variant of it — plain `destructive` misses 4.5:1 on a card in
                        // light mode, and this sits on white.
                        triggerClassName="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        triggerDisabled={pending}
                        title="Delete this entry?"
                        description={`"${e.label}" will be removed from ${itemKey} and the chart will go back to what the remaining entries say. It moves to Trash and can be restored.`}
                        confirmLabel="Delete"
                        confirmVariant="destructive"
                        onConfirm={() => remove(e.recordId!)}
                      />
                    </span>
                  ) : null}
                </div>

                {/* Edit in place, on the row it belongs to. */}
                {editing && ItemEditor ? (
                  <div className="mt-2 space-y-2 rounded-md border p-2.5">
                    <ItemEditor value={editDraft} onChange={setEditDraft} disabled={pending} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={pending} onClick={() => saveEdit(e.recordId!)}>
                        {pending ? "Saving…" : "Save changes"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setEditRow(null);
                          setError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* Record a treatment — its own dated entry, deliberately behind a button.
          If the status controls saved on click, every stray tap would become a line
          in the history, and the history is the thing being built here. */}
      {canAmend && ItemEditor ? (
        adding ? (
          <div className="space-y-2 rounded-md border p-2.5">
            <p className="text-xs font-medium">What are you recording on {itemKey}?</p>
            {/* Treatment or pre-existing. They write to different places on purpose:
                a treatment is an event that joins the history, while "already there"
                corrects the intake snapshot. Collapsing them would have the history
                claim the clinic did work it never did. */}
            <div className="flex overflow-hidden rounded-md border" role="group" aria-label="What kind of record">
              <button
                type="button"
                aria-pressed={!asExisting}
                onClick={() => setAsExisting(false)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  !asExisting ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                Treatment done
              </button>
              <button
                type="button"
                aria-pressed={asExisting}
                onClick={() => setAsExisting(true)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  asExisting ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                Already there
              </button>
            </div>
            <ItemEditor value={draft} onChange={setDraft} disabled={pending} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={record}>
                {pending ? "Saving…" : asExisting ? "Save existing condition" : "Record treatment"}
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
            <p className="text-[11px] text-muted-foreground">
              {asExisting
                ? "Corrects what the patient arrived with. It does not add to the history."
                : "Added to this tooth's history with today's date."}
            </p>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Record on {itemKey}
          </Button>
        )
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canAmend && entries && entries.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Deleting an entry moves it to Trash and re-folds the chart from what is left.
          Entries from a visit are changed in the visit itself.
        </p>
      ) : null}
    </div>
  );
}
