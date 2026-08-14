import type { ModuleDefinition } from "@/core/types/module";
import { dentalScribePrompt } from "@/modules/dental/prompts/scribe";
import { dentalRecallRules } from "@/modules/dental/recall-rules";
import { dentalDrugFormulary } from "@/modules/dental/drug-formulary";
import { dentalProcedureTemplates } from "@/modules/dental/procedure-templates";
import { dentalTreatmentTemplates } from "@/modules/dental/treatment-templates";
import { DentalPatientChart, DentalVisitEditor } from "@/modules/dental/components/tooth-chart";
import { seedFromNote } from "@/modules/dental/seed-from-note";
import {
  getPatientChart,
  saveBaseline,
  saveRecordOnApprove,
  visitChanges,
  toothHistoryFor,
  amendTooth,
} from "@/modules/dental/db/records";
import { dentalPerio } from "@/modules/dental/db/perio";
import { dentalLab } from "@/modules/dental/db/lab";

/**
 * The Dental module — the first (and, for now, only) built specialty.
 *
 * This is the whole contract a module fulfils (CLAUDE.md §4/§13). To add derma
 * later you create /modules/derma/config.ts exporting the same shape and
 * register it in /config/modules.ts — with ZERO changes to core.
 *
 * A module MAY import from /core. Core must NEVER import from here.
 */
export const dentalModule: ModuleDefinition = {
  id: "dental",
  name: "Dental",
  scribePrompt: dentalScribePrompt,
  recallRules: dentalRecallRules,
  drugFormulary: dentalDrugFormulary,
  procedureTemplates: dentalProcedureTemplates,
  treatmentTemplates: dentalTreatmentTemplates,
  // The structured clinical record: the FDI odontogram. Core renders these by the
  // contract (never knowing it's a tooth chart) — the deferred `components` slot.
  clinicalRecord: {
    VisitEditor: DentalVisitEditor,
    PatientChart: DentalPatientChart,
    seedFromNote,
    loadChart: getPatientChart,
    saveRecord: saveRecordOnApprove,
    visitChanges,
    saveBaseline,
    // A tooth is this module's charted item; core only ever passes the key back.
    itemHistory: toothHistoryFor,
    amendItem: amendTooth,
    perio: dentalPerio,
    lab: dentalLab,
  },
};
