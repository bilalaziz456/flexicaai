import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics, patients, users } from "@/core/db/schema/identity";
import { visits } from "@/core/db/schema/clinical";
import {
  DISCOUNT_BEARER_ROWS,
  DISCOUNT_STATUS_ROWS,
  DISCOUNT_TYPE_ROWS,
  discountTypeId,
  type DiscountBearerCode,
  type DiscountStatusCode,
  type DiscountTypeCode,
  APPOINTMENT_STATUS_ROWS,
  RECALL_STATUS_ROWS,
  type AppointmentStatusCode,
  type RecallStatusCode,
} from "@/core/db/vocabulary-seed";
import {
  discountBearers,
  discountStatuses,
  discountTypes,
  vocabularyRef,
  appointmentStatuses,
  recallStatuses,
} from "@/core/db/schema/vocabulary";
import { softDeleteColumns } from "@/core/db/schema/_shared";

/**
 * Appointments, doctor leave, and recalls — when people are seen.
 *
 * Part of the schema split (delta D-09) — see `./index.ts`.
 */

/** Appointment lifecycle. */
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  // Live-queue states between confirmed and completed: `arrived` = checked in and
  // waiting in the room; `in_progress` = called in / with the doctor now (the real
  // "now serving"). See core/appointments/status.ts.
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

/**
 * Appointments — shared. `module` tags which specialty the appointment is for
 * (e.g. 'dental'). It is deliberately a free-text tag, NOT an enum: core must
 * stay module-agnostic and new specialties must not require a schema change.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    status: vocabularyRef<AppointmentStatusCode>(APPOINTMENT_STATUS_ROWS, "status")
      .notNull()
      .default("scheduled")
      .references(() => appointmentStatuses.id),
    // When the patient checked in (status → 'arrived'). Drives the "waiting N min"
    // read-out in the live queue; cleared if the visit reverts to scheduled/confirmed.
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    // Staff booked this visit at a time OUTSIDE the doctor's configured windows — a
    // procedure arranged for 6pm when the doctor consults 1–3pm, say. Persisted
    // rather than derived, because the schedule can change afterwards: without it a
    // later edit would re-validate against TODAY's hours and refuse to save a visit
    // that was deliberately booked outside them.
    //
    // It relaxes the WORKING-HOURS check only. Leave and the daily cap still apply —
    // a custom time says when the doctor agreed to come in, not that they are on call
    // during their holiday or past their own cap.
    customTime: boolean("custom_time").notNull().default(false),
    reason: text("reason"),
    // Optional discount off the doctor's consultation fee for this appointment.
    // `discountType` is 'amount' (flat PKR, the default) or 'percent' (of the
    // fee); `discountValue` is the raw figure (e.g. 500, or 20 for 20%). The net
    // fee is derived live from the doctor's current fee — see
    // core/appointments/fee.ts#computeFee — never stored, so a fee change flows
    // through. Kept as free-text/int (not an enum) to stay additive.
    discountType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_type_id")
      .notNull()
      .default("amount")
      .references(() => discountTypes.id),
    discountValue: integer("discount_value").notNull().default(0),
    // Who absorbs the discount in the doctor/clinic revenue split: 'clinic'
    // (default), 'doctor', or 'split'. Drives core/appointments/shares.ts and the
    // approval workflow. Free-text (not an enum) to stay additive.
    discountBorneBy: vocabularyRef<DiscountBearerCode>(DISCOUNT_BEARER_ROWS, "discount_borne_by_id")
      .notNull()
      .default("clinic")
      .references(() => discountBearers.id),
    // Approval state of THIS appointment's discount (free-text, not an enum):
    //   'none'     — no discount, or none of the reduced parties require approval
    //                → the discount applies (this is the default, so behaviour is
    //                unchanged for clinics that don't opt in);
    //   'pending'  — required approver(s) haven't all signed off → discount is
    //                treated as 0 in the bill/sale/split until they do;
    //   'approved' — every required approver granted it → discount applies;
    //   'rejected' — a required approver declined → discount treated as 0 (staff
    //                re-submit by editing, which recomputes fresh pending rows).
    // Rows live in `appointment_discount_approvals`. See
    // core/appointments/approvals.ts and docs/doctor-shares-plan.md §6.
    discountStatus: vocabularyRef<DiscountStatusCode>(DISCOUNT_STATUS_ROWS, "discount_status_id")
      .notNull()
      .default("none")
      .references(() => discountStatuses.id),
    // For a borne='split' discount, how much of it the DOCTOR side bears: 'percent'
    // = a % of the discount, 'amount' = a fixed PKR figure (shown as its equivalent
    // %). A fixed amount does NOT scale — `discount_split_stale` is set when the
    // discount later changes so staff re-enter it. Only meaningful when
    // discount_borne_by = 'split'. See docs/discount-bearing-plan.md.
    discountSplitType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_split_type_id")
      .notNull()
      .default("percent")
      .references(() => discountTypes.id),
    discountSplitValue: integer("discount_split_value").notNull().default(0),
    discountSplitStale: boolean("discount_split_stale").notNull().default(false),
    // Whether the doctor's consultation fee is charged for this visit. A patient
    // who comes only for a procedure has no consultation fee → set false and the
    // bill/sale count only the procedures. Default true (charge, as before).
    chargeConsultation: boolean("charge_consultation").notNull().default(true),
    // Denormalized cache of Σ collected against this appointment's bill (from
    // patient_payments; updated on every payment). Drives the appointment-list
    // Payment filter/badge without aggregating the ledger. Payment status is derived
    // vs the bill (computeBill): collected ≥ bill Paid · 0<collected<bill Partial ·
    // 0 Unpaid. See core/billing.
    amountCollected: integer("amount_collected").notNull().default(0),
    // How the appointment was created — free-text tag, default 'staff'. Patient
    // WhatsApp self-bookings are 'whatsapp': those stay a request until staff
    // confirm, and the patient's confirmation message fires on that confirm.
    source: text("source").notNull().default("staff"),
    // Set when the day-before WhatsApp reminder has been sent, so the reminder
    // cron never messages the same appointment twice. Null = not yet reminded.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // Patient queue token. `queueSession` groups a doctor's appointments for a
    // single visiting WINDOW on a day (key: `${doctorId}:${YYYY-MM-DD}:w{idx}`,
    // or `:day` for a flexible/no-window doctor); `queueNumber` is the FCFS
    // position within that session (assigned at booking, stable across
    // cancellations). Both NULL when no doctor is assigned. See
    // core/appointments/queue.ts.
    queueSession: text("queue_session"),
    queueNumber: integer("queue_number"),
    // Payment-receipt number (RCP series), allocated ONCE on the first money-in for
    // this visit (`core/billing/payments.ts`) — NULL until then. Resets per year; the
    // label is `<clinics.receipt_prefix><receipt_year>-<7-digit receipt_no>`.
    receiptNo: integer("receipt_no"),
    receiptYear: integer("receipt_year"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The vocabulary behind the money columns. Each of these is a branch the bill,
    // the share split or the approval flow takes, and each falls back to a default
    // rather than raising — so a bad value produces a wrong figure, not an error.
    // A PERCENT discount above 100 isn't a bigger discount, it's a typo — and this
    // exact field, unbounded, overflowed int4 in the SQL bill and made Postgres throw
    // where TS clamped (ADR-021, D-17). The app validates and clamps on every write
    // path; this makes the invariant true regardless of which one is used. A flat
    // AMOUNT stays unbounded: the bill clamps it, and a large write-off is valid.
    check(
      "appointments_percent_discount_max",
      sql`${t.discountType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountValue} between 0 and 100`,
    ),
    check(
      "appointments_percent_split_max",
      sql`${t.discountSplitType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountSplitValue} between 0 and 100`,
    ),
    index("appointments_clinic_id_idx").on(t.clinicId),
    // Receipt numbers are unique per clinic per year (they reset each year).
    uniqueIndex("appointments_receipt_unique")
      .on(t.clinicId, t.receiptYear, t.receiptNo)
      .where(sql`${t.receiptNo} is not null`),
    index("appointments_patient_id_idx").on(t.patientId),
    // Calendar/day views query by clinic + time window.
    index("appointments_clinic_scheduled_idx").on(t.clinicId, t.scheduledAt),
    index("appointments_doctor_id_idx").on(t.doctorId),
    // Trash listing per clinic: only trashed appointments (directly deleted).
    index("appointments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    // The reminder cron scans "active, un-reminded, scheduled within a window".
    index("appointments_reminder_scan_idx").on(t.scheduledAt, t.reminderSentAt),
    // Queue tokens are unique within a (clinic, session). NULLs are distinct in
    // Postgres, so un-queued (no-doctor) rows never collide. Also serves as the
    // lookup index for "max number in this session" during assignment.
    uniqueIndex("appointments_queue_unique").on(
      t.clinicId,
      t.queueSession,
      t.queueNumber,
    ),
  ],
);

/** Recall lifecycle — the recall engine reads and advances these. */
export const recallStatus = pgEnum("recall_status", [
  "pending",
  "scheduled",
  "sent",
  "booked",
  "completed",
  "cancelled",
]);

/**
 * Recalls — shared. The recall engine (core) reads these, applies each module's
 * rules, and sends reminders. `module` tags specialty; `reason` is human text
 * like '6-month cleaning'. `sourceVisitId` links back to the visit that created it.
 */
export const recalls = pgTable(
  "recalls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    sourceVisitId: uuid("source_visit_id").references(() => visits.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: vocabularyRef<RecallStatusCode>(RECALL_STATUS_ROWS, "status")
      .notNull()
      .default("pending")
      .references(() => recallStatuses.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recalls_clinic_id_idx").on(t.clinicId),
    index("recalls_patient_id_idx").on(t.patientId),
    // The engine scans "what's due for this clinic up to date X".
    index("recalls_clinic_due_idx").on(t.clinicId, t.dueAt),
    index("recalls_status_idx").on(t.status),
    // Trash listing per clinic: only trashed recalls.
    index("recalls_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Doctor leave / vacation — shared/core. A row marks a doctor unavailable across
 * an inclusive date range [startDate, endDate] (a single day sets both equal).
 * Set by the receptionist or clinic admin; booking is blocked on these days and
 * existing appointments in the range are cancelled when the leave is created.
 */
export const doctorLeaves = pgTable(
  "doctor_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doctor_leaves_clinic_id_idx").on(t.clinicId),
    // The booking guard asks "is THIS doctor on leave on date X".
    index("doctor_leaves_doctor_range_idx").on(
      t.doctorId,
      t.startDate,
      t.endDate,
    ),
    // Trash listing per clinic: only trashed leave entries.
    index("doctor_leaves_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type DoctorLeave = typeof doctorLeaves.$inferSelect;

export type Appointment = typeof appointments.$inferSelect;

export type Recall = typeof recalls.$inferSelect;
