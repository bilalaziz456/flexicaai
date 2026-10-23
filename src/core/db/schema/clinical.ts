import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import type { PrescriptionItem } from "@/core/lib/prescription-items";
import { appointments } from "@/core/db/schema/scheduling";
import { clinics, patients, users } from "@/core/db/schema/identity";
import { procedures } from "@/core/db/schema/billing";
import { softDeleteColumns } from "@/core/db/schema/_shared";
import {
  VISIT_STATUS_ROWS,
  type VisitStatusCode,
  TREATMENT_PLAN_STATUS_ROWS,
  TREATMENT_ITEM_STATUS_ROWS,
  ATTACHMENT_KIND_ROWS,
  type TreatmentPlanStatusCode,
  type TreatmentItemStatusCode,
  type AttachmentKindCode,
  DISCOUNT_TYPE_ROWS,
  DISCOUNT_BEARER_ROWS,
  discountTypeId,
  type DiscountTypeCode,
  type DiscountBearerCode,
} from "@/core/db/vocabulary-seed";
import {
  visitStatuses,
  vocabularyRef,
  treatmentPlanStatuses,
  treatmentItemStatuses,
  attachmentKinds,
  discountTypes,
  discountBearers,
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
    // The language the doctor dictated in ("en", "ur"), passed to speech-to-text so it
    // does not have to guess — guessing read a 4-second Urdu clip as Spanish
    // (2026-10-20). NULL = let it detect. Stored, not passed through, so a retry and
    // the recovery sweep transcribe the recording the same way. Validated against
    // SCRIBE_LANGUAGES (core/ai/scribe-language.ts); text, not a lookup table — a bad
    // value costs a worse transcript the doctor reviews anyway, never a figure.
    scribeLanguage: text("scribe_language"),
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
    kind: vocabularyRef<AttachmentKindCode>(ATTACHMENT_KIND_ROWS, "kind")
      .notNull()
      .references(() => attachmentKinds.id),
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
    status: vocabularyRef<TreatmentPlanStatusCode>(TREATMENT_PLAN_STATUS_ROWS, "status")
      .notNull()
      .default("proposed")
      .references(() => treatmentPlanStatuses.id),
    note: text("note"),
    // The plan's doctor — optional; names who gives a doctor discount ("Discount by
    // Dr X" on the estimate). The visit it is booked onto keeps its own doctor.
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
    // The OVERALL discount on the plan's subtotal (after each item's own discount).
    discountType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_type_id")
      .notNull()
      .default("amount")
      .references(() => discountTypes.id),
    discountValue: integer("discount_value").notNull().default(0),
    // Who gives the plan's discounts — item and overall alike, chosen once per plan:
    // clinic, doctor, or split (the doctor's part as % or Rs of the total). Carried
    // onto a visit booked from the plan as that visit's "Discount borne by".
    discountBorneBy: vocabularyRef<DiscountBearerCode>(DISCOUNT_BEARER_ROWS, "discount_borne_by_id")
      .notNull()
      .default("clinic")
      .references(() => discountBearers.id),
    discountSplitType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_split_type_id")
      .notNull()
      .default("percent")
      .references(() => discountTypes.id),
    discountSplitValue: integer("discount_split_value").notNull().default(0),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plans_patient_idx").on(t.clinicId, t.patientId),
    // ADR-021: a percentage over 100 is a typo, never a bigger discount.
    check(
      "treatment_plans_percent_discount_max",
      sql`${t.discountType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountValue} between 0 and 100`,
    ),
    check(
      "treatment_plans_percent_split_max",
      sql`${t.discountSplitType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountSplitValue} between 0 and 100`,
    ),
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
    // The clinic OFFER on this procedure, SNAPSHOTTED when the item was added — the
    // estimate is a promise, so an offer ending later does not re-price it. 0 = none
    // (never had one, or "Remove offer"). Booked onto a visit as that line's discount,
    // exactly as an offer is on any booking.
    offerType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "offer_type_id")
      .notNull()
      .default("amount")
      .references(() => discountTypes.id),
    offerValue: integer("offer_value").notNull().default(0),
    // This item's own plan discount, taken off its price AFTER the offer.
    discountType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_type_id")
      .notNull()
      .default("amount")
      .references(() => discountTypes.id),
    discountValue: integer("discount_value").notNull().default(0),
    status: vocabularyRef<TreatmentItemStatusCode>(TREATMENT_ITEM_STATUS_ROWS, "status")
      .notNull()
      .default("planned")
      .references(() => treatmentItemStatuses.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plan_items_plan_idx").on(t.planId),
    index("treatment_plan_items_clinic_idx").on(t.clinicId),
    index("treatment_plan_items_appt_idx").on(t.appointmentId),
    check(
      "treatment_plan_items_percent_offer_max",
      sql`${t.offerType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.offerValue} between 0 and 100`,
    ),
    check(
      "treatment_plan_items_percent_discount_max",
      sql`${t.discountType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountValue} between 0 and 100`,
    ),
  ],
);

export type PatientMedicalHistory = typeof patientMedicalHistory.$inferSelect;

export type ClinicalAttachment = typeof clinicalAttachments.$inferSelect;

/**
 * A TYPED prescription — what the doctor wrote, entered at the desk (owner's call,
 * 2026-10-14), printed on the clinic's letterhead. Distinct from the prescriptions inside
 * an approved scribe note (visits.note), which stay where they are. Soft-deleted to
 * Trash. `items` is checked and bounded by core/lib/prescription-items.ts.
 */
export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    // Set when this prescription was made from an APPROVED scribe note's medicines
    // (owner's call, 2026-10-24), so it prints, downloads, edits and deletes like any
    // typed one. The signed note itself is never changed. Unique: one per visit, and a
    // deleted one still counts, so deleting it does not bring the note's copy back.
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    // The PRESCRIBING doctor (whoever typed it is `created_by`).
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
    doctorName: text("doctor_name"), // snapshot
    prescribedOn: date("prescribed_on").notNull(),
    items: jsonb("items").$type<PrescriptionItem[]>().notNull().default([]),
    notes: text("notes"),
    printDoctorName: boolean("print_doctor_name").notNull().default(true),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prescriptions_patient_idx").on(t.clinicId, t.patientId),
    uniqueIndex("prescriptions_visit_unique").on(t.visitId).where(sql`${t.visitId} is not null`),
    index("prescriptions_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type Prescription = typeof prescriptions.$inferSelect;

/**
 * The MASTER medicine list (owner's call, 2026-10-19) — company-wide, no clinic_id,
 * managed by the super admin at /admin/medicines and suggested on every clinic's
 * prescription and medical-history medicine lines. Names only: picking one fills the
 * medicine field, nothing else, so there is no dose or caution here to review.
 *
 * `specialties` holds module ids as plain TEXT tags ("dental"), like the `module`
 * column elsewhere — data, not code, so a new specialty needs no schema change. A
 * clinic whose enabled modules match sees those medicines first.
 *
 * Retired, never deleted (`is_active`): a prescription that names it still reads
 * the same, it is just no longer suggested.
 */
export const medicines = pgTable(
  "medicines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Generic name, e.g. "Amoxicillin + Clavulanic acid". */
    name: text("name").notNull(),
    /** Local brands, e.g. {Augmentin, Calamox}. */
    brands: text("brands").array().notNull().default(sql`'{}'::text[]`),
    form: text("form"),
    strength: text("strength"),
    specialties: text("specialties").array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("medicines_name_unique").on(sql`lower(${t.name})`)],
);

export type Medicine = typeof medicines.$inferSelect;

/**
 * A clinic's OWN medicines — brands the master list does not have, kept for that
 * clinic only and never copied into the master list by itself. The super admin can
 * see them (read-only) and add a useful one to the master list by hand.
 */
export const clinicMedicines = pgTable(
  "clinic_medicines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brands: text("brands").array().notNull().default(sql`'{}'::text[]`),
    form: text("form"),
    strength: text("strength"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clinic_medicines_name_unique")
      .on(t.clinicId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("clinic_medicines_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type ClinicMedicine = typeof clinicMedicines.$inferSelect;

export type TreatmentPlan = typeof treatmentPlans.$inferSelect;

export type TreatmentPlanItem = typeof treatmentPlanItems.$inferSelect;

export type Visit = typeof visits.$inferSelect;
