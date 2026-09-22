"use client";

import { useState, useTransition } from "react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { toast } from "@/core/ui/toast";
import { useVocabularyOptions } from "@/core/ui/vocabulary-provider";
import {
  editCashCountNote,
  editCashTransfer,
  removeCashCount,
  removeCashTransfer,
} from "./cash-actions";

/**
 * Editing and deleting a drawer entry.
 *
 * A COUNT AND A MOVE ARE NOT EQUALLY EDITABLE, and the asymmetry is the point rather
 * than an omission. A move is a plain record of money going somewhere, so a typo is
 * just a typo and all of it can be corrected. A count's figures are a claim about a
 * MOMENT — what was in the box, and what the ledgers said at that instant — so only
 * its note can be changed afterwards. The way to correct a miscount is to count
 * again, which is the thing this page exists to make easy.
 *
 * Deleting is SOFT either way (ADR-006). It matters more than usual here: a variance
 * somebody can make disappear is a variance nobody has to answer for, so the row
 * survives in Trash with who removed it.
 */
export function CountRowActions({ id, note }: { id: string; note: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const [busy, start] = useTransition();

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label="Count note"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-56"
          placeholder="What explains it?"
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await editCashCountNote(id, value);
              if (r.error) toast.error(r.error);
              else {
                toast.success("Note saved.");
                setEditing(false);
              }
            })
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit note
      </Button>
      <ConfirmDialog
        triggerLabel="Delete"
        triggerVariant="ghost"
        triggerClassName="text-destructive hover:text-destructive"
        title="Delete this count?"
        description="The drawer will re-base on the previous count instead, so every figure after it changes. The record stays in Trash."
        confirmLabel="Delete count"
        confirmVariant="destructive"
        onConfirm={async () => {
          const r = await removeCashCount(id);
          if (r.error) return { error: r.error };
          toast.success("Count deleted.");
        }}
      />
    </div>
  );
}

export function MoveRowActions({
  id,
  kind,
  amount,
  reference,
}: {
  id: string;
  kind: string;
  amount: number;
  reference: string | null;
}) {
  const kinds = useVocabularyOptions("cash_transfer_kinds");
  const [editing, setEditing] = useState(false);
  const [k, setK] = useState(kind);
  const [amt, setAmt] = useState(String(amount));
  const [ref, setRef] = useState(reference ?? "");
  const [busy, start] = useTransition();

  if (editing) {
    return (
      <div className="flex flex-wrap items-end justify-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">What</Label>
          <SelectField value={k} onValueChange={setK} options={kinds} ariaLabel="What happened" className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Amount</Label>
          <Input
            aria-label="Amount"
            value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ""))}
            className="h-9 w-24"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Reference</Label>
          <Input aria-label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} className="h-9 w-32" />
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await editCashTransfer(id, { kind: k, amount: Number(amt), reference: ref });
              if (r.error) toast.error(r.error);
              else {
                toast.success("Saved.");
                setEditing(false);
              }
            })
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <ConfirmDialog
        triggerLabel="Delete"
        triggerVariant="ghost"
        triggerClassName="text-destructive hover:text-destructive"
        title="Delete this entry?"
        description="The drawer figure will change by this amount. The record stays in Trash."
        confirmLabel="Delete entry"
        confirmVariant="destructive"
        onConfirm={async () => {
          const r = await removeCashTransfer(id);
          if (r.error) return { error: r.error };
          toast.success("Deleted.");
        }}
      />
    </div>
  );
}
