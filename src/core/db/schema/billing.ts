import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "@/core/db/schema/scheduling";
import { clinics, patients, users } from "@/core/db/schema/identity";
import {
  PAYMENT_KIND_ROWS,
  PAYMENT_METHOD_ROWS,
  SETTLEMENT_KIND_ROWS,
  SETTLEMENT_PARTY_ROWS,
  APPROVAL_STATUS_ROWS,
  DISCOUNT_TYPE_ROWS,
  discountTypeId,
  settlementKindId,
  type PaymentKindCode,
  type PaymentMethodCode,
  type SettlementKindCode,
  type SettlementPartyCode,
  type ApprovalStatusCode,
  type DiscountTypeCode,
} from "@/core/db/vocabulary-seed";
import {
  approvalStatuses,
  discountTypes,
  paymentKinds,
  paymentMethods,
  settlementKinds,
  settlementParties,
  vocabularyRef,
} from "@/core/db/schema/vocabulary";
import { softDeleteColumns } from "@/core/db/schema/_shared";

/**
 * Money owed and money moved — the priced catalog, per-appointment line
 * items, the realised-revenue ledgers, doctor shares and settlements, patient
 * payments, invoices and clinic expenses.
 *
 * Part of the schema split (delta D-09) — see `./index.ts`.
 */

/**
 * Priced procedures/treatments a clinic offers (e.g. "Cleaning", "Root canal").
 * CORE + specialty-agnostic: the STRUCTURE is generic (a named priced service);
 * the specialty only supplies suggested defaults (see the module registry). Each
 * clinic manages its own list + prices. `module` tags the specialty for later
 * per-specialty reporting. Gated by the `sales` feature (core/lib/features.ts).
 */
export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Price in whole PKR.
    price: integer("price").notNull().default(0),
    module: text("module"),
    // Inactive procedures are hidden from booking but kept for history.
    isActive: boolean("is_active").notNull().default(true),
    // The import batch this row came from (NULL = added in-app) — for undo. See patients.
    importBatchId: uuid("import_batch_id"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("procedures_clinic_id_idx").on(t.clinicId),
    // The booking picker lists a clinic's ACTIVE procedures.
    index("procedures_clinic_active_idx").on(t.clinicId, t.isActive),
    // Trash listing per clinic: only trashed procedures.
    index("procedures_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Per-(doctor, procedure) revenue-share OVERRIDE (percent 0-100). A row = a
 * specific rate for that doctor on that procedure (a stored `0` means "0% — all to
 * the clinic", which is DIFFERENT from having no row → fall back to the doctor's
 * `procedure_share_pct` default). See docs/doctor-shares-plan.md.
 */
export const doctorProcedureShares = pgTable(
  "doctor_procedure_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
    sharePct: integer("share_pct").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One override per doctor+procedure; also the lookup key for the resolver.
    uniqueIndex("doctor_procedure_shares_unique").on(t.doctorId, t.procedureId),
    index("doctor_procedure_shares_clinic_idx").on(t.clinicId),
  ],
);

/**
 * Discount approvals — one row per party (the clinic, and/or each affected doctor)
 * that must sign off on an appointment's discount before it applies. Rows are
 * (re)generated whenever the discount/borne-by changes (see
 * core/appointments/approvals.ts#syncDiscountApprovals); the appointment's overall
 * `discount_status` is derived from them. `approverKind` = 'clinic' | 'doctor';
 * a 'doctor' row names the affected doctor in `approverDoctorId` (they alone decide
 * it), while a 'clinic' row is decided by anyone holding the clinic's
 * discount-approval capability. `decidedBy`/`decidedByName` snapshot who acted.
 */
export const appointmentDiscountApprovals = pgTable(
  "appointment_discount_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    approverKind: vocabularyRef<SettlementPartyCode>(SETTLEMENT_PARTY_ROWS, "approver_kind_id")
      .notNull()
      .references(() => settlementParties.id),
    approverDoctorId: uuid("approver_doctor_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    status: vocabularyRef<ApprovalStatusCode>(APPROVAL_STATUS_ROWS, "status_id")
      .notNull()
      .default("pending")
      .references(() => approvalStatuses.id),
    // Who decided + a name snapshot (no FK on the id: users are soft-deleted).
    decidedBy: uuid("decided_by"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A discount only applies once every required party has approved, and the
    // approver's side is read as 'clinic' vs 'doctor' when deriving
    // appointments.discount_status. An unrecognised value is never "approved", so a
    // typo here silently withholds a discount the clinic granted.
    index("appt_discount_approvals_appt_idx").on(t.appointmentId),
    // The clinic-approver queue scans "this clinic's pending clinic-borne rows".
    index("appt_discount_approvals_clinic_status_idx").on(t.clinicId, t.status),
    // The doctor queue scans "my pending rows".
    index("appt_discount_approvals_doctor_status_idx").on(
      t.approverDoctorId,
      t.status,
    ),
  ],
);

/**
 * Sales ledger — one row per COMPLETED appointment (the `sales` feature). The
 * amounts are SNAPSHOTTED when the appointment is marked completed (doctor's
 * consultation fee + Σ procedures, minus discount), so a later fee/discount/
 * procedure edit or a catalog price change never rewrites historical revenue.
 * `occurred_at` is the visit date (the appointment's scheduled time). A sale is
 * removed when the appointment leaves "completed" (or is deleted — FK cascade).
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    grossAmount: integer("gross_amount").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    netAmount: integer("net_amount").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One sale per appointment (upserted on completion).
    uniqueIndex("sales_appointment_unique").on(t.appointmentId),
    // The report aggregates by clinic + date window.
    index("sales_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("sales_doctor_idx").on(t.doctorId),
  ],
);

/**
 * Per-doctor share ledger (doctor revenue-share feature). One row per DOCTOR who
 * earned a positive share on a COMPLETED appointment — a snapshot of what they're
 * owed, frozen at completion (via core/appointments/shares.ts#computeShare on the
 * approval-gated net) so later rate/discount edits never rewrite history. The
 * CLINIC's cut is derived (sale net − Σ these rows), so there is no clinic row here.
 * A multi-doctor visit produces several rows; recording replaces all rows for the
 * appointment. Payment is tracked as an amount-based running balance (Phase 7):
 * Earned = Σ share_amount, Paid = Σ doctor_payouts.amount, Outstanding = the
 * difference — there is no per-share paid flag. See docs/doctor-shares-plan.md §7-8,11.
 */

/**
 * Doctor payouts — one row per PAYMENT to a doctor against their accrued shares
 * (revenue-share, Phase 6-7). Amount-based running balance: a payment is an
 * ARBITRARY amount (partial allowed), validated ≤ the doctor's outstanding. The
 * balance is Σ sale_shares − Σ these amounts; deleting a payout (a correction)
 * simply raises the balance again. `amount`, who recorded it, and the (optional)
 * covered period are snapshots. `method`/`reference` record how it was paid. See
 * core/sales/payouts.ts.
 */
export const doctorPayouts = pgTable(
  "doctor_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    amount: integer("amount").notNull().default(0),
    method: vocabularyRef<PaymentMethodCode>(PAYMENT_METHOD_ROWS, "method_id").references(
      () => paymentMethods.id,
    ),
    reference: text("reference"), // cheque/transaction no. etc.
    periodStart: date("period_start"), // optional; a period the payment covers
    periodEnd: date("period_end"),
    note: text("note"),
    createdBy: uuid("created_by"), // no FK — users are soft-deleted
    createdByName: text("created_by_name"), // snapshot
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Payment methods are declared once in core/finance/payment-methods.ts; this
    // keeps the column honest whatever writes it (a script, a backfill, psql).
    // Nullable, and a CHECK passes on null, so "unspecified" stays legal.
    index("doctor_payouts_clinic_doctor_idx").on(t.clinicId, t.doctorId),
    index("doctor_payouts_clinic_created_idx").on(t.clinicId, t.createdAt),
  ],
);

export const saleShares = pgTable(
  "sale_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot (survives rename / soft-delete)
    shareAmount: integer("share_amount").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Replace-all-for-an-appointment + cascade cleanup.
    index("sale_shares_appointment_idx").on(t.appointmentId),
    // The report aggregates by clinic + date window.
    index("sale_shares_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    // "This doctor's earnings" (report + balance).
    index("sale_shares_clinic_doctor_idx").on(t.clinicId, t.doctorId),
  ],
);

/**
 * Discount settlements (doctor↔clinic bearing) — one snapshot row per PARTY per
 * completed appointment that carries an (effective) discount. Captures how the
 * discount is borne: the bearing party's balance moves by `settlement_amount`
 * (signed; negative = they bear a loss / a doctor may go into deficit), the
 * protected party is untouched. Accrual, computed at completion on the NET bill +
 * gross shares (NOT scaled by collection) — see docs/discount-bearing-plan.md §3.
 * Rewritten (replace-all-for-appointment) on the completion/edit/approval hooks,
 * exactly like `sale_shares`; a clinic row has `doctor_id` NULL.
 */
export const discountSettlements = pgTable(
  "discount_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    party: vocabularyRef<SettlementPartyCode>(SETTLEMENT_PARTY_ROWS, "party_id")
      .notNull()
      .references(() => settlementParties.id),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }), // NULL for the clinic row
    doctorName: text("doctor_name"), // snapshot
    grossShare: integer("gross_share").notNull().default(0), // this party's pre-discount gross cut (reference)
    settlementAmount: integer("settlement_amount").notNull().default(0), // signed balance adjustment
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The zero-sum transfer has exactly two sides. A third value would be summed
    // into neither balance, so the settlement would stop netting to zero without
    // anything reporting an error.
    index("discount_settlements_appointment_idx").on(t.appointmentId),
    index("discount_settlements_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("discount_settlements_clinic_doctor_idx").on(t.clinicId, t.doctorId),
  ],
);

/**
 * Doctor settlement actions — the manual money moves on a doctor's share balance:
 * a `doctor_waive` (doctor forgoes his own share, relieving the clinic), a
 * `clinic_waive` (clinic forgives a doctor's deficit — a clinic cost), a
 * `repayment` (doctor→clinic, settling a deficit from pocket), a `write_off`
 * (clinic writes a departed doctor's debt off), or a `reversal` (undo one of the
 * above, `reverses_id` → the reversed row). Amounts are positive PKR; the effect on
 * the balance comes from `kind`. `line_ref` scopes a waive to one earning line (a
 * procedure id, or 'consultation'); NULL = the whole visit. Audit-logged; clinic-
 * side kinds need the `share_waive` permission (a doctor waives his own by identity).
 */
export const doctorSettlementActions = pgTable(
  "doctor_settlement_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    // The visit the action relates to (NULL for a standalone repayment/write-off).
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    lineRef: text("line_ref"), // procedure id | 'consultation' | NULL (whole visit)
    kind: vocabularyRef<SettlementKindCode>(SETTLEMENT_KIND_ROWS, "kind_id")
      .notNull()
      .references(() => settlementKinds.id),
    amount: integer("amount").notNull().default(0), // positive PKR; meaning by kind
    reversesId: uuid("reverses_id"), // self-ref (no FK); the row a reversal undoes
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The kind IS the sign of the money move: core/finance/pl.ts#plActionEffect and
    // core/sales/payouts.ts both switch on it and fall through to 0 for anything
    // unrecognised — so a bad value doesn't raise, it quietly drops the amount out of
    // the P&L and the doctor's balance. ('reversal' is designed for but not yet
    // written — voids currently delete the row; the constraint permits it so the
    // feature isn't blocked at the DB.)
    index("doctor_settlement_actions_clinic_doctor_idx").on(t.clinicId, t.doctorId),
    index("doctor_settlement_actions_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("doctor_settlement_actions_appointment_idx").on(t.appointmentId),
    // At most ONE per-line doctor_waive per (appointment, line) — makes a double-waive
    // race impossible at the DB level (a duplicate insert 23505s). Only per-line waives
    // (line_ref set) are constrained; amount-based waives (line_ref NULL) are not.
    uniqueIndex("doctor_settlement_actions_line_waive_uniq")
      .on(t.appointmentId, t.lineRef)
      .where(
        sql`${t.kind} = ${sql.raw(String(settlementKindId("doctor_waive")))} and ${t.lineRef} is not null and ${t.appointmentId} is not null`,
      ),
  ],
);

/**
 * Patient payments ledger (Finance — patient billing). Every money movement on a
 * patient's account: a `payment` against a visit's bill, an `advance` (prepaid
 * credit — `appointment_id` NULL), an `advance_applied` (credit consumed by a
 * bill), or a `refund`. Amounts are positive PKR; the sign/meaning comes from
 * `kind`. Collected on a visit = Σ(payment + advance_applied) for that
 * appointment; patient credit = Σadvance − Σadvance_applied − Σrefund. Soft-
 * deletable (a void is a soft delete, linked via `reverses_id`). See core/billing.
 */
export const patientPayments = pgTable(
  "patient_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    // NULL = an unallocated advance (patient-level credit, not tied to a visit).
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    kind: vocabularyRef<PaymentKindCode>(PAYMENT_KIND_ROWS, "kind_id")
      .notNull()
      .references(() => paymentKinds.id),
    amount: integer("amount").notNull().default(0),
    method: vocabularyRef<PaymentMethodCode>(PAYMENT_METHOD_ROWS, "method_id").references(
      () => paymentMethods.id,
    ),
    reference: text("reference"),
    note: text("note"),
    // The entry a refund/void reverses (traceability); no FK (self-ref, soft-del).
    reversesId: uuid("reverses_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The kind decides whether a row is collected, credit, money out, or an imported
    // opening-balance settlement. Every consumer switches on it and ignores what it
    // doesn't recognise, so an unknown kind is money that silently reports nowhere.
    // NOTE: 'opening' is a real fifth kind (settleOpeningBalance) that the original
    // column comment omitted — it must stay in this list.
    // Tenders PLUS the system marker 'advance', which `applyAdvance` writes for a bill
    // settled from stored credit — no tender changed hands, so it is never offered in a
    // form, but the column legitimately holds it. See STORED_PAYMENT_METHODS.
    index("patient_payments_clinic_patient_idx").on(t.clinicId, t.patientId),
    index("patient_payments_appointment_idx").on(t.appointmentId),
    index("patient_payments_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("patient_payments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Invoices (Finance — patient billing). One per completed appointment. The bill
 * amount is derived live from `computeBill` (not stored), so a later edit flows
 * through; the invoice just records that a numbered document was issued.
 * `invoiceNo` is a per-clinic sequential integer (allocated by atomically bumping
 * `clinics.next_invoice_no`), shown with `clinics.invoice_prefix`. Soft-deletable
 * (a void keeps the number). See core/billing.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    invoiceNo: integer("invoice_no").notNull(),
    // The invoice's calendar year — part of the label and the uniqueness key (numbers
    // reset per year, so `invoice_no` alone repeats across years). Backfilled from
    // `issued_at` for pre-existing invoices (migration 0072).
    invoiceYear: integer("invoice_year"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid("issued_by"),
    issuedByName: text("issued_by_name"),
    note: text("note"),
    ...softDeleteColumns(),
  },
  (t) => [
    // One live invoice per appointment (soft-deleted ones don't block a re-issue).
    uniqueIndex("invoices_appointment_unique")
      .on(t.appointmentId)
      .where(sql`${t.deletedAt} is null`),
    // Numbers are unique per clinic PER YEAR (they reset each year).
    uniqueIndex("invoices_clinic_year_no_unique").on(t.clinicId, t.invoiceYear, t.invoiceNo),
    index("invoices_clinic_issued_idx").on(t.clinicId, t.issuedAt),
    index("invoices_patient_idx").on(t.patientId),
  ],
);

/**
 * Expense categories (Finance) — a clinic's editable list (Rent, Salaries, …). Not
 * soft-deleted; deactivate with `is_active` (kept for history on past expenses).
 */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expense_categories_clinic_idx").on(t.clinicId, t.isActive)],
);

/**
 * Expenses (Finance) — the clinic's costs (rent, salaries, supplies, lab, …). Feeds
 * the P&L (net profit = collected revenue − doctor shares − expenses). Soft-
 * deletable (recoverable). `recurring` tags a repeating cost (drives "duplicate" and
 * a future cron). See core/expenses. Gated by the `finance` feature.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => expenseCategories.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull().default(0),
    incurredOn: date("incurred_on").notNull(),
    vendor: text("vendor"),
    method: vocabularyRef<PaymentMethodCode>(PAYMENT_METHOD_ROWS, "method_id").references(
      () => paymentMethods.id,
    ),
    reference: text("reference"),
    note: text("note"),
    recurring: boolean("recurring").notNull().default(false),
    // When `recurring`, the repeat interval ('monthly' | 'weekly') and the next date
    // the cron should materialise a fresh (non-recurring) copy of this expense.
    // NULL on a one-off expense and on a generated copy. See core/expenses/recurring.ts.
    recurrence: text("recurrence"),
    nextRunOn: date("next_run_on"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_clinic_incurred_idx").on(t.clinicId, t.incurredOn),
    index("expenses_clinic_category_idx").on(t.clinicId, t.categoryId),
    index("expenses_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    // The recurring-expense cron scans due templates across all clinics.
    index("expenses_recurring_due_idx")
      .on(t.nextRunOn)
      .where(sql`${t.recurring} = true and ${t.deletedAt} is null`),
  ],
);

/**
 * Line items linking an appointment to the priced procedures it's booked for /
 * had done (the `sales` feature). Name + unit price are SNAPSHOTTED so editing
 * or deleting the catalog procedure never rewrites past appointments/sales.
 * `clinic_id` is carried for cheap per-procedure reporting without joining
 * appointments. Appointment total = doctor's consultation fee + Σ(unit×qty);
 * the appointment's discount then applies to that total.
 */
export const appointmentProcedures = pgTable(
  "appointment_procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id").references(() => procedures.id, {
      onDelete: "set null",
    }),
    // The PERFORMING doctor for this line (revenue share goes to them). NULL =
    // falls back to the appointment's consulting doctor. See docs/doctor-shares-plan.md.
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(), // snapshot
    unitPrice: integer("unit_price").notNull().default(0), // snapshot, PKR
    quantity: integer("quantity").notNull().default(1),
    // Optional per-line discount, applied to THIS line's gross (unit_price×qty)
    // BEFORE the appointment-level discount. 'amount' = flat PKR, 'percent' = %
    // of the line. Free-text/int (not enums) to stay additive.
    discountType: vocabularyRef<DiscountTypeCode>(DISCOUNT_TYPE_ROWS, "discount_type_id")
      .notNull()
      .default("amount")
      .references(() => discountTypes.id),
    discountValue: integer("discount_value").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 'percent' is the branch the bill maths takes; anything else is treated as a
    // flat amount, so a typo turns "20%" into "Rs 20 off". Complements the
    // percent-range check below, which only bites once the type is 'percent'.
    index("appt_procedures_appointment_idx").on(t.appointmentId),
    index("appt_procedures_clinic_idx").on(t.clinicId),
    index("appt_procedures_procedure_idx").on(t.procedureId),
    // A PERCENT discount above 100 isn't a bigger discount, it's a typo — and this
    // exact field, unbounded, overflowed int4 in the SQL bill and made Postgres throw
    // where TS clamped (ADR-021, D-17). The app validates and clamps on every write
    // path; this makes the invariant true regardless of which one is used. A flat
    // AMOUNT stays unbounded: the bill clamps it, and a large write-off is valid.
    check(
      "appt_procedures_percent_discount_max",
      sql`${t.discountType} <> ${sql.raw(String(discountTypeId("percent")))} or ${t.discountValue} between 0 and 100`,
    ),
  ],
);

export type Procedure = typeof procedures.$inferSelect;

export type DoctorProcedureShare = typeof doctorProcedureShares.$inferSelect;

export type AppointmentDiscountApproval =
  typeof appointmentDiscountApprovals.$inferSelect;

export type AppointmentProcedure = typeof appointmentProcedures.$inferSelect;

export type Sale = typeof sales.$inferSelect;

export type SaleShare = typeof saleShares.$inferSelect;

export type DiscountSettlement = typeof discountSettlements.$inferSelect;

export type DoctorSettlementAction = typeof doctorSettlementActions.$inferSelect;

export type DoctorPayout = typeof doctorPayouts.$inferSelect;

export type PatientPayment = typeof patientPayments.$inferSelect;

export type Invoice = typeof invoices.$inferSelect;

export type ExpenseCategory = typeof expenseCategories.$inferSelect;

export type Expense = typeof expenses.$inferSelect;
