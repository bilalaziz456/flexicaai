"use client";

import { useState, useTransition } from "react";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Toast } from "@/core/ui/toast";
import { savePerioExamAction } from "./patient-clinical-actions";

/**
 * The periodontal chart card body — read-only latest exam by default, with a "Record
 * perio exam" toggle (when `canEdit`) that opens the 6-site editor and saves a new
 * dated exam. Module-agnostic via the client clinical-UI registry; renders nothing if
 * the clinic's modules ship no perio.
 */
export function PerioChartCard({
  latest,
  patientId,
  modulesEnabled,
  canEdit,
}: {
  latest: unknown;
  patientId: string;
  modulesEnabled: string[];
  canEdit: boolean;
}) {
  const ui = clinicalUiFor(modulesEnabled);
  const [editing, setEditing] = useState(false);
  // A new exam starts from the last one (re-measure), so nothing is re-typed.
  const [value, setValue] = useState<unknown>(latest ?? {});
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);

  if (!ui?.perio) return null;
  const { Chart, Editor } = ui.perio;

  const save = () =>
    start(async () => {
      const r = await savePerioExamAction(patientId, value, note || null);
      if ("error" in r) setMsg({ text: r.error, error: true });
      else {
        setMsg({ text: "Perio exam recorded.", error: false });
        setEditing(false);
        setNote("");
      }
      setNonce((n) => n + 1);
    });

  return (
    <div className="space-y-3">
      {editing ? (
        <>
          <Editor value={value} onChange={setValue} />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save exam"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setValue(latest ?? {});
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <Chart chart={value} />
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Record perio exam
            </Button>
          ) : null}
        </>
      )}
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
