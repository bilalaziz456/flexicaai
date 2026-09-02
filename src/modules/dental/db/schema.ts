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
import { clinics, patients, softDeleteColumns, treatmentPlanItems, visits } from "@/core/db/schema";
import { vocabularyRef } from "@/core/db/schema/vocabulary";
import {
  LAB_ITEM_ROWS,
  LAB_STATUS_ROWS,
  type LabItemCode,
  type LabStatusCode,
} from "@/modules/dental/vocabulary";

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
  | "exfoliated"
  | "unerupted"
  | "watch";

/** One tooth's current state in the living chart. */
export type ChartTooth = {
  status: ToothStatus;
  surfaces?: string[];
  /**
   * Root-treated. Deliberately NOT a `status`, because endodontic and restorative
   * state are independent axes: a root canal is nearly always followed by a crown,
   * and with one status field the crown overwrote the root canal and the tooth
   * silently stopped being root-treated. A paper chart marks the root and the crown
   * separately for exactly this reason.
   *
   * Lives in the `teeth` jsonb, so it needs no migration, and absent means false, so
   * every chart written before this keeps working. Post and core go in `note`.
   */
  endo?: boolean;
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
  /** Free text for this tooth at this exam ("furcation involvement, refer"). Lives in
   *  the `teeth` jsonb, so it needs no migration. Distinct from `perio_exams.note`,
   *  which is the note for the exam as a whole. */
  note?: string;
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
    /**
     * What kind of record this is when it belongs to no visit: 'treatment', charted
     * straight onto a tooth outside a visit. NULL on everything written before this
     * existed, where the kind is unambiguous anyway — a baseline has `is_baseline`, a
     * visit record has `visit_id` — so nothing needed backfilling.
     */
    kind: text("kind"),
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

/**
 * `lab_cases` — crowns/dentures/appliances sent to a dental lab (Phase 6). MODULE
 * (dental). Status changes drive the "your crown is ready" WhatsApp. Optionally
 * links to the visit + treatment-plan item it belongs to; `cost` is the lab bill.
 */
export const labCases = pgTable(
  "lab_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    planItemId: uuid("plan_item_id").references(() => treatmentPlanItems.id, { onDelete: "set null" }),
    labName: text("lab_name"),
    item: vocabularyRef<LabItemCode>(LAB_ITEM_ROWS, "item")
      .notNull()
      .references(() => dentalLabItems.id),
    tooth: text("tooth"), // FDI, nullable
    shade: text("shade"),
    status: vocabularyRef<LabStatusCode>(LAB_STATUS_ROWS, "status")
      .notNull()
      .default("sent")
      .references(() => dentalLabStatuses.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    cost: integer("cost"), // PKR
    note: text("note"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lab_cases_patient_idx").on(t.clinicId, t.patientId),
    index("lab_cases_status_idx").on(t.clinicId, t.status),
    index("lab_cases_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type DentalRecord = typeof dentalRecords.$inferSelect;
export type DentalChart = typeof dentalCharts.$inferSelect;
export type PerioExam = typeof perioExams.$inferSelect;
export type LabCase = typeof labCases.$inferSelect;

/* ────────────────────────────────────────────────────────────────────────────
 * The module's own vocabulary tables (migration `0094`).
 *
 * Module-OWNED, in the module's schema — core must never see a dental table. They use
 * the same shape and the same custom column type as core's, so the application still
 * reads and writes CODES while the column is an integer foreign key. The seed rows and
 * ids live in `modules/dental/vocabulary.ts`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `lab_cases.status`. */
export const dentalLabStatuses = pgTable("dental_lab_statuses", {
  id: integer("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

/** `lab_cases.item`. */
export const dentalLabItems = pgTable("dental_lab_items", {
  id: integer("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});
