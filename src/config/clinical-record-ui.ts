import type { ComponentType } from "react";
import type { ClinicalVisitEditorProps, PatientChartProps } from "@/core/types/module";
import { DentalPatientChart, DentalVisitEditor } from "@/modules/dental/components/tooth-chart";
import { seedFromNote as dentalSeedFromNote } from "@/modules/dental/seed-from-note";

/**
 * CLIENT-SAFE clinical-record UI registry — the client counterpart to
 * `config/modules.ts`. Client components (the scribe workspace, the chart editor)
 * can't import the server registry because its `clinicalRecord` also carries
 * server-only data functions (`loadChart`/`saveRecord`). This holds ONLY the pieces
 * safe to run in the browser: the `VisitEditor` component + the pure `seedFromNote`.
 * Adding derma later adds one entry here (and one in `config/modules.ts`).
 *
 * This file — like `config/modules.ts` — is the one place allowed to name modules.
 */
export type ClinicalRecordUI = {
  VisitEditor: ComponentType<ClinicalVisitEditorProps>;
  PatientChart: ComponentType<PatientChartProps>;
  /** Map a scribe draft note into suggested chart edits (pure). */
  seedFromNote: (note: unknown) => unknown;
};

const CLINICAL_UI: Record<string, ClinicalRecordUI> = {
  dental: {
    VisitEditor: DentalVisitEditor,
    PatientChart: DentalPatientChart,
    seedFromNote: dentalSeedFromNote,
  },
};

/** The client clinical editor UI for a clinic's enabled modules (first match), or none. */
export function clinicalUiFor(
  modulesEnabled: readonly string[],
): ClinicalRecordUI | undefined {
  for (const id of modulesEnabled) {
    if (CLINICAL_UI[id]) return CLINICAL_UI[id];
  }
  return undefined;
}
