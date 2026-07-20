/**
 * Dental MODULE-owned Drizzle tables (CLAUDE.md §5 / docs/dental-clinical-plan.md §3).
 *
 * Specialty tables live here, NOT in core `schema.ts`, so core stays specialty-
 * agnostic. drizzle-kit picks this file up via the glob in `drizzle.config.ts`;
 * module code imports these tables and passes them to the core `db.select()` client
 * (the app uses no relational `db.query`, so the core client needs no merge). A
 * module MAY import from /core (FK targets, the shared soft-delete columns); core
 * must NEVER import from here.
 *
 * Phase 1: `dental_records` (the structured note per visit) + `dental_charts` (the
 * living per-patient odontogram). Phase 2 adds `perio_exams`; Phase 6 adds `lab_cases`.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics, patients, softDeleteColumns, visits } from "@/core/db/schema";

// ─── jsonb payload types (co-located with the tables) ───────────────────────

/**
 * Tooth status vocabulary (fixed set so the odontogram stays consistent). FDI
 * numbering; surfaces use M/D/O(I)/B(F)/L(P). See `modules/dental/tooth-status.ts`
 * for labels/colours. Kept as a union type here so the jsonb columns are typed.
 */
export type ToothStatus =
  | "sound"
  | "caries"
  | "filled"
  | "crown"
  | "bridge_pontic"
  | "bridge_abutment"
  | "veneer"
  | "sealant"
  | "root_canal"
  | "implant"
  | "fractured"
  | "to_extract"
  | "missing"
  | "unerupted"
  | "watch";

/** One tooth's current state in the living chart. */
export type ChartTooth = {
  status: ToothStatus;
  surfaces?: string[];
  note?: string;
  /** The visit whose record last set this tooth (audit link back into history). */
  updatedVisitId?: string | null;
};

/** FDI tooth number (e.g. "16", "21", "55") → its current state. */
export type ChartTeeth = Record<string, ChartTooth>;

/** A finding recorded at a visit (what was observed on a tooth). */
export type ToothFinding = {
  tooth: string | null;
  surfaces?: string[];
  condition: string;
  note?: string;
};

/** A procedure done at a visit (what was performed on a tooth). */
export type ToothProcedure = {
  tooth: string | null;
  procedure: string;
  note?: string;
};

/**
 * One tooth's periodontal measurements. Six sites per tooth in FDI order —
 * MB, B, DB (buccal) then ML, L, DL (lingual/palatal). Pocket depth + recession in
 * mm; bleeding-on-probing + suppuration per site; mobility/furcation 0–3; plaque.
 */
export type PerioTooth = {
  pockets?: (number | null)[]; // 6 sites
  recession?: (number | null)[]; // 6 sites
  bleeding?: boolean[]; // 6 sites
  suppuration?: boolean[]; // 6 sites
  mobility?: number; // 0–3
  furcation?: number; // 0–3
  plaque?: boolean;
};

/** FDI tooth number → its periodontal measurements for one exam. */
export type PerioTeeth = Record<string, PerioTooth>;

// ─── tables ─────────────────────────────────────────────────────────────────

/**
 * `dental_records` — the structured dental note for one visit (1:1 with a `visit`),
 * OR a patient's intake **baseline** (`is_baseline`, no visit) that seeds existing
 * conditions. `chart_after` is the per-tooth snapshot AFTER this record — the history
 * frame the living `dental_charts` is the reduction of.
 */
export const dentalRecords = pgTable(
  "dental_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    // NULL for a baseline record; unique when set (one dental record per visit).
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "cascade" }),
    isBaseline: boolean("is_baseline").notNull().default(false),
    chiefComplaint: text("chief_complaint"),
    diagnosis: text("diagnosis"),
    findings: jsonb("findings").$type<ToothFinding[]>(),
    proceduresDone: jsonb("procedures_done").$type<ToothProcedure[]>(),
    // Per-tooth status snapshot AFTER this record folds in (the history frame).
    chartAfter: jsonb("chart_after").$type<ChartTeeth>(),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One record per visit (NULLs — baselines — are distinct, so they don't collide).
    uniqueIndex("dental_records_visit_uq")
      .on(t.visitId)
      .where(sql`${t.visitId} is not null`),
    // At most one LIVE baseline per patient.
    uniqueIndex("dental_records_baseline_uq")
      .on(t.patientId)
      .where(sql`${t.isBaseline} = true and ${t.deletedAt} is null`),
    index("dental_records_clinic_idx").on(t.clinicId),
    index("dental_records_patient_idx").on(t.patientId),
    index("dental_records_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `dental_charts` — the living per-patient odontogram (1 row/patient): the
 * materialised current state, rebuildable from the ordered `dental_records`
 * (`chart_after` frames). Each approved record folds its changes in.
 */
export const dentalCharts = pgTable(
  "dental_charts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    teeth: jsonb("teeth").$type<ChartTeeth>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dental_charts_patient_uq").on(t.patientId),
    index("dental_charts_clinic_idx").on(t.clinicId),
  ],
);

/**
 * `perio_exams` — a full periodontal chart per examination. Unlike the restorative
 * odontogram (folded into a living chart), perio is re-measured wholesale each exam,
 * so each row is a complete snapshot and "current perio" = the latest exam. May be
 * tied to a visit or standalone. `bop_percent` is the derived bleeding-on-probing %.
 */
export const perioExams = pgTable(
  "perio_exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    examDate: timestamp("exam_date", { withTimezone: true }).notNull().defaultNow(),
    teeth: jsonb("teeth").$type<PerioTeeth>().notNull().default({}),
    bopPercent: integer("bop_percent").notNull().default(0),
    note: text("note"),
    chartedBy: uuid("charted_by"),
    chartedByName: text("charted_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("perio_exams_clinic_idx").on(t.clinicId),
    index("perio_exams_patient_idx").on(t.clinicId, t.patientId, t.examDate),
    index("perio_exams_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type DentalRecord = typeof dentalRecords.$inferSelect;
export type DentalChart = typeof dentalCharts.$inferSelect;
export type PerioExam = typeof perioExams.$inferSelect;
