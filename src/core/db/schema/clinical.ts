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
import type { Allergy, Medication } from "@/core/lib/medical-history";
import { appointments } from "@/core/db/schema/scheduling";
import { clinics, patients, users } from "@/core/db/schema/identity";
import { procedures } from "@/core/db/schema/billing";
import { softDeleteColumns } from "@/core/db/schema/_shared";
import {
  VISIT_STATUS_ROWS,
  type VisitStatusCode,
} from "@/core/db/vocabulary-seed";
import {
  visitStatuses,
  vocabularyRef,
} from "@/core/db/schema/vocabulary";

/**
 * The clinical record — visits (the AI note), medical history, attachments
 * and treatment plans. Specialty-shaped data (a tooth chart) belongs to the MODULE
 * that owns it, never here (CLAUDE.md §5).
 *
 * Part of the schema split (delta D-09) — see `./index.ts`.
 */

/**
 * Visits — shared; stores the generated note. `module` tags specialty. The
 * structured note is JSONB whose SHAPE is defined by the module (dental note
 * shape ≠ derma), keeping core specialty-agnostic. Specialty relational data
 * (e.g. tooth-chart rows) goes in a module table linked to the visit, not here.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    status: vocabularyRef<VisitStatusCode>(VISIT_STATUS_ROWS, "status")
      .notNull()
      .default("draft")
      .references(() => visitStatuses.id),
    // Raw Whisper transcript kept for the accuracy flywheel (CLAUDE.md §8).
    transcript: text("transcript"),
    // Module-shaped structured note (the doctor's approved/edited version).
    note: jsonb("note").$type<Record<string, unknown>>(),
    // The AI's ORIGINAL draft, frozen at generation time. Diffing it against
    // `note` yields the doctor's edits — the accuracy flywheel (CLAUDE.md §8).
    aiDraft: jsonb("ai_draft").$type<Record<string, unknown>>(),
    // Storage key of the source audio (for the flywheel / re-transcription).
    audioKey: text("audio_key"),
    // When the async scribe run started. The recovery sweep uses it to find runs the
    // process died in the middle of — without it a killed job leaves a visit stuck in
    // `transcribing` forever, and nothing anywhere would say so (D-08).
    transcribeStartedAt: timestamp("transcribe_started_at", { withTimezone: true }),
    // Why a run failed, shown to the doctor so "try again" is an informed choice
    // rather than a guess. Never carries provider payloads — just the reason.
    transcribeError: text("transcribe_error"),
    // True when this note was IMPORTED from a clinic's old system (not authored in
    // FlexicaAI) — freeform text lives in `note.summary`, shown as "Imported" in the
    // clinical timeline. See docs/import-plan.md (Phase 2).
    imported: boolean("imported").notNull().default(false),
    // Import batch this row came from (NULL = created in-app) — enables undo.
    importBatchId: uuid("import_batch_id"),
    visitDate: timestamp("visit_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("visits_clinic_id_idx").on(t.clinicId),
    index("visits_patient_id_idx").on(t.patientId),
    index("visits_clinic_date_idx").on(t.clinicId, t.visitDate),
    index("visits_appointment_id_idx").on(t.appointmentId),
    // Trash listing per clinic: only trashed visits.
    index("visits_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `patient_medical_history` — CORE, specialty-agnostic (every specialty needs it).
 * 1:1 with a patient; the LATEST snapshot (the audit log covers who changed what).
 * Gates the drug formulary: prescribing a drug that matches a recorded allergy warns.
 * Types + the allergy gate live in `core/lib/medical-history.ts`.
 */
export const patientMedicalHistory = pgTable(
  "patient_medical_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    allergies: jsonb("allergies").$type<Allergy[]>().notNull().default([]),
    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    medications: jsonb("medications").$type<Medication[]>().notNull().default([]),
    smoking: text("smoking"),
    alcohol: text("alcohol"),
    notes: text("notes"),
    updatedBy: uuid("updated_by"),
    updatedByName: text("updated_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("patient_medical_history_patient_uq").on(t.patientId),
    index("patient_medical_history_clinic_idx").on(t.clinicId),
  ],
);

/**
 * `clinical_attachments` — CORE imaging/photos/docs/consent (specialty-agnostic;
 * derma/hair reuse it for before/after photos). Bytes live in clinic-scoped storage
 * (`saveClinicFile(clinicId, "clinical", …)`), served by the authorized route
 * `GET /api/clinical/attachment/[id]`. `is_photo` drives the photo-consent gate.
 */
export const clinicalAttachments = pgTable(
  "clinical_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // xray | photo | document | consent
    storageKey: text("storage_key").notNull(),
    /**
     * A small JPEG copy for the gallery grid. NULL is normal and permanent for
     * non-images, for rows uploaded before this existed, and whenever the browser
     * could not produce one — every reader falls back to `storage_key`.
     *
     * The ORIGINAL is never resized: these are diagnostic images a clinician may
     * compare months apart. This exists only so a 150px thumbnail stops costing a
     * full-size download.
     */
    thumbKey: text("thumb_key"),
    mime: text("mime"),
    caption: text("caption"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    isPhoto: boolean("is_photo").notNull().default(false),
    uploadedBy: uuid("uploaded_by"),
    uploadedByName: text("uploaded_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinical_attachments_patient_idx").on(t.clinicId, t.patientId),
    index("clinical_attachments_visit_idx").on(t.visitId),
    index("clinical_attachments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `treatment_plans` — CORE (specialty-agnostic): a multi-visit, priced course of
 * treatment for a patient. `module` is a free-text tag. Derma/hair reuse this for
 * their own courses. Soft-deletable.
 */
export const treatmentPlans = pgTable(
  "treatment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    module: text("module").notNull().default(""),
    title: text("title").notNull(),
    status: text("status").notNull().default("proposed"), // proposed|active|completed|cancelled
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plans_patient_idx").on(t.clinicId, t.patientId),
    index("treatment_plans_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `treatment_plan_items` — the planned procedures. `name`/`unit_price` are SNAPSHOTS
 * (like appointment_procedures) so catalog edits never rewrite a plan. `tooth` is
 * FDI (dental fills it; others leave null). Scheduling an item links it to an
 * appointment and mints an `appointment_procedures` line, so plans feed Sales via
 * the SAME money path.
 */
export const treatmentPlanItems = pgTable(
  "treatment_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => treatmentPlans.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id").references(() => procedures.id, { onDelete: "set null" }),
    name: text("name").notNull(), // snapshot
    unitPrice: integer("unit_price").notNull().default(0), // snapshot, PKR
    tooth: text("tooth"), // FDI, nullable
    quantity: integer("quantity").notNull().default(1),
    status: text("status").notNull().default("planned"), // planned|in_progress|done|cancelled
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plan_items_plan_idx").on(t.planId),
    index("treatment_plan_items_clinic_idx").on(t.clinicId),
    index("treatment_plan_items_appt_idx").on(t.appointmentId),
  ],
);

export type PatientMedicalHistory = typeof patientMedicalHistory.$inferSelect;

export type ClinicalAttachment = typeof clinicalAttachments.$inferSelect;

export type TreatmentPlan = typeof treatmentPlans.$inferSelect;

export type TreatmentPlanItem = typeof treatmentPlanItems.$inferSelect;

export type Visit = typeof visits.$inferSelect;
