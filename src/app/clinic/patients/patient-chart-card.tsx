"use client";

import { useState } from "react";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import { Toast } from "@/core/ui/toast";
import { ItemHistoryPanel } from "./item-history-panel";
import { MultiItemPanel } from "./multi-item-panel";

/**
 * The patient's odontogram card.
 *
 * Everything a tooth needs is on the tooth. Clicking a tooth SELECTS it and clicking it
 * again deselects it — no mode to switch (owner's call, 2026-10-15):
 *  - one tooth selected → its history, where a treatment is recorded, corrected or
 *    deleted ("Already there" writes the intake snapshot rather than a treatment);
 *  - several selected (47, 48, 33) → one treatment recorded on all of them, each tooth
 *    still getting its own dated history entry.
 *
 * Module-agnostic via the client clinical-UI registry; renders nothing if the
 * clinic's modules ship no chart.
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
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  // The selected items, in the order they were clicked.
  const [selected, setSelected] = useState<string[]>([]);
  // Bumped after a group save so the group form starts fresh.
  const [groupRun, setGroupRun] = useState(0);

  if (!ui) return null;
  const { PatientChart } = ui;
  const items = (chart ?? {}) as Record<string, unknown>;

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  // The group form starts from the group's state only when every selected item shares it.
  const sharedCurrent = (() => {
    if (selected.length < 2) return null;
    const first = JSON.stringify(items[selected[0]] ?? null);
    return selected.every((k) => JSON.stringify(items[k] ?? null) === first) ? (items[selected[0]] ?? null) : null;
  })();

  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className="space-y-3">
      <PatientChart chart={chart} onSelectItem={toggle} selectedItems={selected} />
      {single ? (
        <ItemHistoryPanel
          key={single}
          patientId={patientId}
          itemKey={single}
          canAmend={canEdit}
          // Seed the form with what the item is now, so recording a root canal on a
          // filled tooth doesn't silently drop the filling.
          current={items[single] ?? null}
          ItemEditor={ui.ItemEditor}
          onClose={() => setSelected([])}
          onAmended={() => {
            setMsg({ text: "Chart updated.", error: false });
            setNonce((n) => n + 1);
          }}
        />
      ) : selected.length > 1 && canEdit && ui.ItemEditor ? (
        <MultiItemPanel
          key={groupRun}
          patientId={patientId}
          itemKeys={selected}
          sharedCurrent={sharedCurrent}
          ItemEditor={ui.ItemEditor}
          onClear={() => setSelected([])}
          onDone={(summary) => {
            setMsg({ text: summary, error: false });
            setNonce((n) => n + 1);
            setSelected([]);
            setGroupRun((n) => n + 1);
          }}
        />
      ) : selected.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {selected.length} teeth selected: {selected.join(", ")}. Select one tooth to see its history.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? "Click a tooth to see its history or record a treatment. Click more teeth to record the same treatment on all of them; click a tooth again to deselect it."
            : "Select a tooth to see its history."}
        </p>
      )}
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
