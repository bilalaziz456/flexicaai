import type { ModuleDefinition } from "@/core/types/module";
import { dentalScribePrompt } from "@/modules/dental/prompts/scribe";
import { dentalChartSchema, dentalNoteSchema } from "@/modules/dental/note-schema";
import { dentalRecallRules } from "@/modules/dental/recall-rules";
import { dentalDrugFormulary } from "@/modules/dental/drug-formulary";
import { dentalProcedureTemplates } from "@/modules/dental/procedure-templates";
import { dentalTreatmentTemplates } from "@/modules/dental/treatment-templates";
import { DentalPatientChart, DentalVisitEditor } from "@/modules/dental/components/tooth-chart";
import { DentalToothEditor } from "@/modules/dental/components/tooth-editor";
import { seedFromNote } from "@/modules/dental/seed-from-note";
import {
  getPatientChart,
  saveBaseline,
  saveRecordOnApprove,
  visitChanges,
  toothHistoryFor,
  editToothRecord,
  deleteToothRecord,
  recordToothTreatment,
  setToothBaseline,
  dentalTrash,
} from "@/modules/dental/db/records";
import { dentalPerio } from "@/modules/dental/db/perio";
import { dentalLab } from "@/modules/dental/db/lab";
import { DENTAL_VOCABULARIES } from "@/modules/dental/vocabulary";

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
  // What the prompt above asks for, as a check on what actually came back — and on
  // what the dentist edits it into before it becomes the record.
  noteSchema: dentalNoteSchema,
  chartSchema: dentalChartSchema,
  recallRules: dentalRecallRules,
  drugFormulary: dentalDrugFormulary,
  procedureTemplates: dentalProcedureTemplates,
  treatmentTemplates: dentalTreatmentTemplates,
  // The module's own closed vocabularies. Core never imports these — the registry
  // aggregates them and the app injects them (ADR-001).
  vocabularies: DENTAL_VOCABULARIES,

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
    editItemRecord: editToothRecord,
    deleteItemRecord: deleteToothRecord,
    recordItemTreatment: recordToothTreatment,
    setItemBaseline: setToothBaseline,
    ItemEditor: DentalToothEditor,
    trash: dentalTrash,
    perio: dentalPerio,
    lab: dentalLab,
  },
};
