"use client";

import { useState } from "react";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import { Toast } from "@/core/ui/toast";
import { ItemHistoryPanel } from "./item-history-panel";

/**
 * The patient's odontogram card.
 *
 * Everything a tooth needs is on the tooth: click it for its history, and record a
 * treatment, correct an entry or delete one from the panel that opens. The old "Edit
 * existing conditions" mode switch is gone — it hid the history behind a second mode,
 * and its one distinct job (recording what the patient ARRIVED with) is now the
 * "Already there" option in that same panel, which still writes the intake snapshot
 * rather than a treatment.
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
  // Which charted item's panel is open. Clicking the same one again closes it.
  const [openItem, setOpenItem] = useState<string | null>(null);

  if (!ui) return null;
  const { PatientChart } = ui;

  return (
    <div className="space-y-3">
      <PatientChart
        chart={chart}
        onSelectItem={(key) => setOpenItem((cur) => (cur === key ? null : key))}
        selectedItem={openItem}
      />
      {openItem ? (
        <ItemHistoryPanel
          key={openItem}
          patientId={patientId}
          itemKey={openItem}
          canAmend={canEdit}
          // Seed the form with what the item is now, so recording a root canal on a
          // filled tooth doesn't silently drop the filling.
          current={(chart as Record<string, unknown> | null)?.[openItem] ?? null}
          ItemEditor={ui.ItemEditor}
          onClose={() => setOpenItem(null)}
          onAmended={() => {
            setMsg({ text: "Chart updated.", error: false });
            setNonce((n) => n + 1);
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? "Select a tooth to see its history or record a treatment."
            : "Select a tooth to see its history."}
        </p>
      )}
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
