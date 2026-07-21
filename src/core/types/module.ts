/**
 * The module system contract — CORE (CLAUDE.md §4).
 *
 * This file defines the SHAPE every specialty module must implement. Core code
 * depends only on these interfaces; it never imports a concrete module and never
 * hardcodes a specialty id. Adding derma/hair later means implementing this
 * interface in /modules and registering it — zero core changes.
 */

import type { ComponentType } from "react";

/** A module/specialty id, e.g. "dental". Kept as a plain string so core stays agnostic. */
export type ModuleId = string;

/** A recall interval the recall engine schedules from (CLAUDE.md §10 recall). */
export interface RecallRule {
  id: string;
  /** Human label shown to staff/patients, e.g. "6-month cleaning". */
  label: string;
  /** Interval from the triggering visit, in days (e.g. 182 ≈ 6 months). */
  intervalDays: number;
  /** Why this recall exists; used in reminder copy. */
  reason: string;
}

/** A medication in a module's formulary (validated before showing — CLAUDE.md §8). */
export interface Drug {
  /** Generic/INN name, e.g. "Amoxicillin". */
  name: string;
  /** Local brand names (Pakistan/GCC), e.g. ["Amoxil", "Moxin"]. */
  brands: string[];
  /** e.g. "tablet", "capsule", "suspension". */
  form: string;
  /** A common starting dosage string, e.g. "500 mg TID x 5 days". */
  defaultDosage?: string;
  notes?: string;
}

/**
 * The full definition a BUILT module provides. `components` (specialty UI like a
 * tooth chart) is intentionally omitted until the doctor panel needs it (Step 7)
 * — we don't abstract UI before a second module exists (CLAUDE.md §12).
 */
export interface ProcedureTemplate {
  /** Procedure name, e.g. "Scaling & polishing". */
  name: string;
  /** Suggested price in whole PKR; the clinic can edit after importing. */
  price: number;
}

/**
 * A multi-visit treatment-plan template a module suggests (e.g. "RCT + crown").
 * `items` are procedure NAMES — the plan builder matches them to the clinic's own
 * priced `procedures` for the snapshot price (unmatched names still add, price 0).
 */
export interface TreatmentTemplate {
  name: string;
  items: string[];
}

/** Props core passes to a module's structured visit editor (e.g. the tooth chart). */
export interface ClinicalVisitEditorProps {
  /** The structured record being edited (module-shaped) — seeded from the scribe draft. */
  value: unknown;
  /** Controlled update as the doctor edits (still a DRAFT until the visit is approved). */
  onChange: (value: unknown) => void;
}

/** Props core passes to a module's read-only patient chart (e.g. the current odontogram). */
export interface PatientChartProps {
  /** The patient's current chart state (module-shaped). */
  chart: unknown;
}

/**
 * Optional periodontal charting a module supplies (dental). Each save is a new
 * dated exam (perio is re-measured wholesale); `loadLatest` returns the current one.
 */
export interface ModulePerio {
  loadLatest: (clinicId: string, patientId: string) => Promise<unknown>;
  saveExam: (
    clinicId: string,
    patientId: string,
    exam: { teeth: unknown; note?: string | null },
    actor: { id: string; name: string },
  ) => Promise<void>;
  /** Per-exam summaries over time (oldest→newest) for the trend. */
  trend: (
    clinicId: string,
    patientId: string,
  ) => Promise<{ examDate: Date; bop: number; maxPocket: number }[]>;
}

/** A lab case (crown/denture/…) — generic shape core renders in the lab tracker. */
export interface LabCaseData {
  id: string;
  labName: string | null;
  item: string;
  tooth: string | null;
  shade: string | null;
  status: string;
  dueAt: Date | null;
  cost: number | null;
  note: string | null;
  createdAt: Date;
}

/**
 * Optional lab-case tracking a module supplies (dental crowns/dentures). Core
 * renders a generic tracker from `statuses`/`itemTypes` + the cases; a status
 * change can fire the module's own "ready" notification.
 */
export interface ModuleLab {
  statuses: string[];
  itemTypes: string[];
  loadCases: (clinicId: string, patientId: string) => Promise<LabCaseData[]>;
  saveCase: (
    clinicId: string,
    patientId: string,
    input: { labName?: string | null; item: string; tooth?: string | null; shade?: string | null; dueAt?: string | null; cost?: number | null; note?: string | null },
    actor: { id: string; name: string },
  ) => Promise<void>;
  updateStatus: (clinicId: string, caseId: string, status: string) => Promise<void>;
  deleteCase: (clinicId: string, caseId: string, actorId: string) => Promise<void>;
}

/**
 * Optional specialty clinical-record UI a module supplies — the `components` slot
 * that was deliberately deferred until the panel needed it (§0). Core renders these
 * BY THE CONTRACT and never knows it's an odontogram: when the enabled module provides
 * this, the visit/scribe screen uses `VisitEditor` instead of the generic NoteEditor,
 * and the patient clinical tab shows `PatientChart`. The concrete prop/record shapes
 * are module-defined (hence `unknown`), tightened alongside the tooth chart in Phase 1.
 */
export interface ModuleClinicalRecord {
  VisitEditor: ComponentType<ClinicalVisitEditorProps>;
  PatientChart: ComponentType<PatientChartProps>;
  /** Map a scribe draft note into the editor's initial value (a pre-filled chart). */
  seedFromNote: (note: unknown) => unknown;
  /**
   * Load the patient's current chart state (server-side — the module reads its own
   * table). Core calls this and passes the result to `PatientChart`, so core never
   * imports a specialty table. Module-shaped, hence `unknown`.
   */
  loadChart: (clinicId: string, patientId: string) => Promise<unknown>;
  /**
   * Persist the structured record when a visit is APPROVED (writes the module's
   * tables + folds the chart). Core calls this after finalising the visit — it
   * never knows it's writing a tooth chart. `chart` is the doctor's confirmed
   * chart when the in-visit editor was used, else the module derives it from `note`.
   */
  saveRecord: (
    clinicId: string,
    input: { visitId: string; patientId: string; note: unknown; chart?: unknown },
  ) => Promise<void>;
  /**
   * Per-visit change summaries for the clinical timeline, keyed by `visitId` (each a
   * list of human lines, e.g. "16: Caries → Root canal"). Core shows them next to the
   * visit without knowing they describe teeth.
   */
  visitChanges: (clinicId: string, patientId: string) => Promise<Record<string, string[]>>;
  /**
   * Save the patient's intake BASELINE chart (existing conditions, no visit) directly
   * — from the "edit chart" flow on the patient page. Re-folds the living chart.
   */
  saveBaseline: (clinicId: string, patientId: string, chart: unknown) => Promise<void>;
  /** Optional periodontal charting (a separate per-exam record). Absent → no perio card. */
  perio?: ModulePerio;
  /** Optional lab-case tracking (crowns/dentures). Absent → no lab card. */
  lab?: ModuleLab;
}

export interface ModuleDefinition {
  id: ModuleId;
  /** Display name of the specialty, e.g. "Dental". */
  name: string;
  /** Specialty system prompt fed to the AI scribe engine. */
  scribePrompt: string;
  recallRules: RecallRule[];
  drugFormulary: Drug[];
  /**
   * Suggested priced procedures a clinic can one-click import into its own
   * catalog (the `sales` feature). Optional — core stays specialty-agnostic and
   * a clinic always edits/adds its own afterwards.
   */
  procedureTemplates?: ProcedureTemplate[];
  /** Suggested multi-visit treatment-plan templates (e.g. "RCT + crown"). */
  treatmentTemplates?: TreatmentTemplate[];
  /**
   * Optional structured clinical-record UI (tooth chart, etc.). When present, core
   * renders it in place of the generic note editor / clinical tab. Absent for a
   * module with no specialty chart — core falls back to the generic NoteEditor.
   */
  clinicalRecord?: ModuleClinicalRecord;
}

/** Whether a specialty is usable now or only planned. */
export type SpecialtyStatus = "available" | "coming_soon";

/**
 * A row in the specialty catalog that powers the Super Admin "create clinic"
 * checkboxes (Step 5). "available" specialties have a real ModuleDefinition;
 * "coming_soon" ones are architected only (derma, hair) — no implementation yet.
 */
export interface SpecialtyCatalogEntry {
  id: ModuleId;
  name: string;
  description: string;
  status: SpecialtyStatus;
}
