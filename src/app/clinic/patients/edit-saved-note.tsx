"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Dialog } from "@/core/ui/dialog";
import { NoteEditor } from "@/core/ui/note-editor";
import type { Medication } from "@/core/lib/medical-history";
import { MedicineRow, type MedicineOption } from "./medicine-row";
import { loadSavedNoteForEdit, saveEditedNote } from "@/app/clinic/scribe/actions";

/**
 * "Edit" on a saved clinical note (owner, 2026-11-19) — dictated or typed, shown only to
 * someone holding `clinical:edit`. The same form as writing a note: its fields in the
 * note editor (with a Clinical notes box to add to, even on an older note) and its
 * medicines in the prescription rows. The text it replaces is kept on the server.
 */
export function EditSavedNoteButton({
  visitId,
  medicineSuggestions,
}: {
  visitId: string;
  medicineSuggestions: readonly MedicineOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<Record<string, unknown> | null>(null);
  const [rx, setRx] = useState<Medication[]>([{ name: "" }]);
  const [warnings, setWarnings] = useState<{ drugWarnings: string[]; allergyWarnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    setWarnings(null);
    startTransition(async () => {
      const r = await loadSavedNoteForEdit(visitId);
      if ("error" in r) {
        setError(r.error);
        setOpen(true);
        setNote(null);
        return;
      }
      setNote(r.note);
      setRx(r.medicines);
      setOpen(true);
    });
  }

  function save() {
    if (!note) return;
    setError(null);
    startTransition(async () => {
      // A second press after the checks showed = the clinician has seen them.
      const r = await saveEditedNote(visitId, note, rx, warnings !== null);
      if ("warnings" in r) setWarnings(r.warnings);
      else if ("error" in r) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  // Any change after the checks showed is checked again.
  const changed = () => setWarnings(null);

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={start} disabled={pending} className="no-print h-7 px-2">
        <PenLine className="size-3.5" aria-hidden="true" />
        Edit
      </Button>
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => (o ? null : setOpen(false))}
          size="lg"
          title="Edit clinical note"
          description="Correct a field or add to the clinical notes. The earlier version is kept, and the note shows it was edited."
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={pending || !note}>
                {pending ? "Saving…" : warnings ? "Save anyway" : "Save changes"}
              </Button>
            </>
          }
        >
          {note ? (
            <div className="space-y-4">
              {warnings && (warnings.allergyWarnings.length > 0 || warnings.drugWarnings.length > 0) ? (
                <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  {warnings.allergyWarnings.map((w) => (
                    <p key={w} className="text-destructive">{w}</p>
                  ))}
                  {warnings.drugWarnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  <p className="text-xs text-muted-foreground">Check them, then press Save anyway.</p>
                </div>
              ) : null}

              <NoteEditor
                note={note}
                onChange={(n) => {
                  setNote(n);
                  changed();
                }}
              />

              <div className="space-y-2" role="group" aria-label="Prescription">
                <p className="text-sm font-medium">Prescription</p>
                {rx.map((m, i) => (
                  <MedicineRow
                    key={i}
                    value={m}
                    showNote
                    showInstruction
                    suggestions={medicineSuggestions}
                    namePlaceholder="Medicine, e.g. Augmentin"
                    onChange={(next) => {
                      setRx((prev) => prev.map((x, j) => (j === i ? next : x)));
                      changed();
                    }}
                    onRemove={() => {
                      setRx((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ name: "" }]));
                      changed();
                    }}
                  />
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => setRx((prev) => [...prev, { name: "" }])}>
                  <Plus className="size-4" aria-hidden="true" /> Medicine
                </Button>
                <p className="text-xs text-muted-foreground">
                  A change here updates the patient&apos;s prescription from this note too.
                </p>
              </div>
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}
