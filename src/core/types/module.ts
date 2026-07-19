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

/** A sidebar/menu entry a module contributes to a panel. */
export interface NavItem {
  label: string;
  /** Route relative to the panel, e.g. "/doctor/tooth-chart". */
  href: string;
  /** Lucide icon name (a string, so core isn't coupled to an icon component). */
  icon?: string;
}

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
}

export interface ModuleDefinition {
  id: ModuleId;
  /** Display name of the specialty, e.g. "Dental". */
  name: string;
  /** Specialty system prompt fed to the AI scribe engine. */
  scribePrompt: string;
  recallRules: RecallRule[];
  drugFormulary: Drug[];
  /** Menu items this module adds to the relevant panels. */
  navItems: NavItem[];
  /**
   * Suggested priced procedures a clinic can one-click import into its own
   * catalog (the `sales` feature). Optional — core stays specialty-agnostic and
   * a clinic always edits/adds its own afterwards.
   */
  procedureTemplates?: ProcedureTemplate[];
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
