"use client";

import { useState, useTransition } from "react";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import { saveBaselineChart } from "./patient-clinical-actions";
import { ItemHistoryPanel } from "./item-history-panel";

/**
 * The patient's odontogram card body — read-only by default, with an "Edit existing
 * conditions" toggle (when `canEdit`) that swaps in the specialty VisitEditor and
 * saves the baseline chart. Module-agnostic via the client clinical-UI registry;
 * renders nothing if the clinic's modules ship no chart.
 */
export function PatientChartCard({
  chart,
  patientId,
  modulesEnabled,
  canEdit,
}: {
  chart: unknown;
  patientId: string;
  modulesEnabled: string[];
  canEdit: boolean;
}) {
  const ui = clinicalUiFor(modulesEnabled);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<unknown>(chart ?? {});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  // Which charted item's history is open. Clicking the same one again closes it.
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  if (!ui) return null;
  const { VisitEditor, PatientChart } = ui;

  const save = () =>
    start(async () => {
      const r = await saveBaselineChart(patientId, value);
      if ("error" in r) setMsg({ text: r.error, error: true });
      else {
        setMsg({ text: "Chart saved.", error: false });
        setEditing(false);
      }
      setNonce((n) => n + 1);
    });

  return (
    <div className="space-y-3">
      {editing ? (
        <>
          <VisitEditor value={value} onChange={setValue} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save chart"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setValue(chart ?? {});
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <PatientChart
            chart={value}
            onSelectItem={(key) => setHistoryOf((cur) => (cur === key ? null : key))}
            selectedItem={historyOf}
          />
          {historyOf ? (
            <ItemHistoryPanel
              key={historyOf}
              patientId={patientId}
              itemKey={historyOf}
              canAmend={canEdit}
              onClose={() => setHistoryOf(null)}
              onAmended={() => {
                setMsg({ text: "Entry corrected.", error: false });
                setNonce((n) => n + 1);
              }}
            />
          ) : null}
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit existing conditions
            </Button>
          ) : null}
        </>
      )}
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
