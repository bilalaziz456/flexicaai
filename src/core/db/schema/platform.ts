import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics, patients, users } from "@/core/db/schema/identity";

import { softDeleteColumns } from "@/core/db/schema/_shared";
import { visits } from "@/core/db/schema/clinical";

/**
 * Platform and company tables — the audit trail, data imports, announcements,
 * and FlexicaAI's OWN books (what clinics pay us, what serving them costs).
 *
 * Part of the schema split (delta D-09) — see `./index.ts`.
 */

/**
 * Import batches — one row per data-import run (super-admin clinic onboarding). Rows
 * it created carry `import_batch_id` so a whole import can be undone in one action
 * (soft-delete the batch). Company-side record of a per-clinic action. See
 * docs/import-plan.md.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(), // patients | procedures
    filename: text("filename"),
    // {imported, skipped, warnings, ...} snapshot for the summary.
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    status: text("status").notNull().default("active"), // active | undone
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_batches_clinic_idx").on(t.clinicId, t.createdAt)],
);

/**
 * Imported financial-history archive (Feature: financial-archive-plan.md). A clinic
 * migrating off its old PMS uploads its old bills/receipts/expenses/doctor-payouts as
 * per-transaction rows so the past is searchable inside FlexicaAI forever.
 *
 * READ-ONLY archive — NEVER joined by a live report. FlexicaAI's money (sales/shares/
 * receivables/P&L) is derived from completed appointments through the billing engine;
 * these rows never happened *in FlexicaAI*, so they must not enter those ledgers or they
 * would double-count revenue and distort every metric. The ONLY sanctioned bridge to
 * live data is the collectible remainder → `patients.opening_balance` (opt-in on the
 * payments commit). One generic table (not five per-entity) with a `type` discriminator
 * and a `raw` jsonb keeping the original row verbatim, so nothing is lost.
 *
 * Uploaded admin-side (owner/super-admin/account-manager) via the clinic-detail
 * importer, gated by `import:create`; the clinic gets a read-only viewer. Reuses the
 * import machinery: `import_batch_id` groups a batch, undone by soft-deleting the group.
 */
export const importedTransactions = pgTable(
  "imported_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    // 'invoice' | 'payment' | 'refund' | 'expense' | 'doctor_payout' (+ optional
    // 'doctor_earning'). Free text, not an enum, so a new kind needs no migration.
    type: text("type").notNull(),
    // The historical date, as given (date-only → no timezone drift). Nullable: a row
    // with no parseable date is a data-quality warning, not a silent now().
    txnDate: date("txn_date"),
    // Whole-PKR snapshot, ALWAYS positive; `type` carries the direction (money in =
    // payment; money out to a patient = refund; expense/doctor_payout = money out).
    amount: integer("amount").notNull().default(0),
    // Who it concerns. Snapshot name ALWAYS set; the *_id only when matched to a live
    // record (both nullable — a money sheet may reference people not in FlexicaAI).
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "set null" }),
    patientName: text("patient_name"),
    externalPatientRef: text("external_patient_ref"), // their old patient no. (match + display)
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
    doctorName: text("doctor_name"),
    // Descriptive, all as given.
    description: text("description"), // line summary / category / memo
    reference: text("reference"), // their old invoice / receipt / voucher no.
    method: text("method"), // cash | bank | cheque | card | other (payments)
    // The ENTIRE original row, verbatim — so nothing is lost and a future specialised
    // report is recoverable without a re-import.
    raw: jsonb("raw").$type<Record<string, string>>(),
    // The import batch this row came from (undo group). No FK — batches are a
    // company-side record (matches patients.importBatchId).
    importBatchId: uuid("import_batch_id"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The viewer scans "this clinic's rows of this type, by date".
    index("imported_txn_clinic_type_date_idx").on(t.clinicId, t.type, t.txnDate),
    index("imported_txn_patient_idx").on(t.patientId),
    index("imported_txn_doctor_idx").on(t.doctorId),
    index("imported_txn_batch_idx").on(t.importBatchId),
    // Contains-search on the person + their old document number.
    index("imported_txn_patient_trgm_idx").using("gin", t.patientName.op("gin_trgm_ops")),
    index("imported_txn_doctor_trgm_idx").using("gin", t.doctorName.op("gin_trgm_ops")),
    index("imported_txn_reference_idx").on(t.clinicId, t.reference),
    // Trash listing (undo) per clinic: only trashed rows.
    index("imported_txn_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `clinic_payments` — the CLINIC → FlexicaAI subscription ledger (manual billing, v1).
 * Mirrors `patient_payments`: each row is a payment RECEIVED from a clinic, covering
 * `months_covered` months, which pushes the clinic's derived `paid_through` forward
 * (unpaid time carries forward as a running balance). Super-admin only. Soft-deletable
 * (a void). See core/admin/billing.ts + docs/super-admin-plan.md §5.1/§11 Feature 6.
 */
export const clinicPayments = pgTable(
  "clinic_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0), // PKR (always positive; sign from kind)
    // 'payment' = money IN from the clinic (+balance, +cash revenue); 'refund' =
    // money OUT to the clinic (−balance, −cash revenue); 'credit' = non-cash account
    // credit / goodwill (+balance, NOT cash revenue). See core/admin/billing.ts.
    kind: text("kind").notNull().default("payment"),
    method: text("method"), // bank | cash | cheque | other
    reference: text("reference"),
    monthsCovered: integer("months_covered").notNull().default(1), // pushes paid_through
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid("recorded_by"),
    recordedByName: text("recorded_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinic_payments_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("clinic_payments_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Platform cost rates (Owner Finance — the COMPANY's serving-cost config). NOT a
 * tenant table (no `clinic_id`): these are FlexicaAI's own unit costs for the metered
 * dependencies. Every rate change inserts a NEW row (history) with `effectiveFrom`
 * — the latest row is the current rate; past periods can later be costed at the
 * rate that was live then. Unit costs are stored in `currency` (USD by default) as
 * decimals; `usdToPkr` converts to the PKR the rest of the app shows. v1 is a
 * count×rate estimate (scribe calls from `visits`, WhatsApp from `whatsapp_messages`)
 * — precise token/minute metering is a later add. See core/admin/cost.ts.
 */
export const platformCostRates = pgTable(
  "platform_cost_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ESTIMATE rates (count × rate) — a flat cost per scribe call (fallback for a
    // visit with no metered usage) and per WhatsApp message, in `currency`.
    scribeCallCost: numeric("scribe_call_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    whatsappMsgCost: numeric("whatsapp_msg_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    // METERED rates (accurate) — Whisper per audio MINUTE, Claude per 1M input /
    // output TOKENS. Used when a scribe call logs real usage (see ai_usage). USD.
    whisperMinuteCost: numeric("whisper_minute_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    claudeInputCost: numeric("claude_input_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    claudeOutputCost: numeric("claude_output_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    usdToPkr: numeric("usd_to_pkr", { precision: 12, scale: 4 }).notNull().default("0"),
    // International-transaction TAX/CHARGES a Pakistani bank adds on the USD payment to
    // the AI/WhatsApp providers (foreign-transaction fee + FED on it + advance tax + any
    // extra). Applied as a % MARKUP on the PKR serving cost at report time (ai_usage
    // stays the raw provider cost). Two modes so the owner can either itemise or enter a
    // single figure; all default 0 → no markup until configured. See core/admin/cost.ts.
    taxMode: text("tax_mode").notNull().default("itemized"), // 'itemized' | 'total'
    foreignTxnFeePct: numeric("foreign_txn_fee_pct", { precision: 12, scale: 4 }).notNull().default("0"),
    fedPct: numeric("fed_pct", { precision: 12, scale: 4 }).notNull().default("0"),
    advanceTaxPct: numeric("advance_tax_pct", { precision: 12, scale: 4 }).notNull().default("0"),
    additionalTaxPct: numeric("additional_tax_pct", { precision: 12, scale: 4 }).notNull().default("0"),
    totalTaxPct: numeric("total_tax_pct", { precision: 12, scale: 4 }).notNull().default("0"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_cost_rates_effective_idx").on(t.effectiveFrom)],
);

/**
 * AI usage meter (Owner Finance — precise serving cost). One row per PAID AI call in
 * a scribe run: a `whisper` row (audio seconds) + a `claude` row (input/output
 * tokens). `cost_pkr` is SNAPSHOTTED at the rates live when recorded (so a later rate
 * change never rewrites history), computed by `core/ai/usage.ts` from
 * `platform_cost_rates`. Lets `computeServingCost` use metered cost instead of the
 * flat per-call estimate. Carries `clinic_id` (cross-tenant reads run `unscoped`).
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // 'whisper' | 'claude'
    model: text("model"),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costPkr: integer("cost_pkr").notNull().default(0), // snapshot at record-time rates
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("ai_usage_occurred_idx").on(t.occurredAt),
    index("ai_usage_visit_idx").on(t.visitId),
  ],
);

/**
 * Company expense categories (Owner Finance — the COMPANY's opex). FlexicaAI's own
 * cost buckets (Payroll, Rent, …). NOT a tenant table (no `clinic_id`). Deactivate
 * with `is_active` (kept for history). See core/admin/company-expenses.ts.
 */
export const companyExpenseCategories = pgTable("company_expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Company expenses (Owner Finance — the COMPANY's operating costs: payroll, rent,
 * software, marketing, …). Feeds the company P&L (net profit = collected revenue −
 * serving cost − these). NOT a tenant table (no `clinic_id` — it's FlexicaAI's own
 * cost, so the tenant guard ignores it). Soft-deletable (recoverable); `recurring`
 * tags a repeating cost the cron materialises each period (reusing the clinic
 * recurring date math). ACL + audit live in the action layer.
 */
export const companyExpenses = pgTable(
  "company_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id").references(() => companyExpenseCategories.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull().default(0), // PKR
    incurredOn: date("incurred_on").notNull(),
    vendor: text("vendor"),
    method: text("method"), // cash | bank | cheque | other
    reference: text("reference"),
    note: text("note"),
    recurring: boolean("recurring").notNull().default(false),
    recurrence: text("recurrence"), // 'monthly' | 'weekly' when recurring
    nextRunOn: date("next_run_on"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_expenses_incurred_idx").on(t.incurredOn),
    index("company_expenses_category_idx").on(t.categoryId),
    index("company_expenses_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    index("company_expenses_recurring_due_idx")
      .on(t.nextRunOn)
      .where(sql`${t.recurring} = true and ${t.deletedAt} is null`),
  ],
);

/**
 * Company settings (Owner Finance) — a SINGLETON config row for FlexicaAI itself (not
 * a tenant). Holds the company-global subscription-invoice counter + prefix (FlexicaAI
 * issues one numbered sequence across all clinics). Seeded lazily. See
 * core/admin/clinic-invoices.ts.
 */
export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  nextInvoiceNo: integer("next_invoice_no").notNull().default(1),
  invoicePrefix: text("invoice_prefix").notNull().default("KL-INV-"),
  // Company-wide default for the Owner Overview churn threshold: a live clinic quiet
  // for ≥ this many days is "at risk". The Overview dropdown overrides it per-view.
  churnInactiveDays: integer("churn_inactive_days").notNull().default(21),
  // Usage/cost anomaly-flag thresholds (Overview). thin_margin = serving cost ≥ this
  // % of MRR; usage_spike = serving cost ≥ this × the prior period, ignoring costs
  // below the floor. See core/admin/health.ts.
  thinMarginPct: integer("thin_margin_pct").notNull().default(50),
  spikeMultiple: integer("spike_multiple").notNull().default(3),
  spikeFloorPkr: integer("spike_floor_pkr").notNull().default(200),
  // How long `activity_logs` rows are kept. **0 = keep forever, and that is the
  // default deliberately**: this is an audit trail over patient data (CLAUDE.md §10),
  // so how long it must survive is a COMPLIANCE decision for the owner, not a number
  // an engineer should pick. The pruning machinery exists so the table can be bounded
  // when it needs to be; it does nothing until someone sets a window. See
  // core/audit/retention.ts.
  activityLogRetentionDays: integer("activity_log_retention_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Clinic subscription invoices (Owner Finance, Phase 4) — invoices/receipts FlexicaAI
 * issues TO a clinic for its subscription (distinct from patient `invoices`).
 * `invoice_no` is a company-global sequence (allocated by locking `company_settings`
 * and bumping `next_invoice_no`), shown with its prefix. `amount` is stored (the
 * agreed charge for the period — usually the clinic's monthly_price). Soft-deletable
 * (a void keeps the number). Cross-tenant super-admin reads → `unscoped`.
 */
export const clinicInvoices = pgTable(
  "clinic_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    invoiceNo: integer("invoice_no").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    amount: integer("amount").notNull().default(0), // PKR
    note: text("note"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid("issued_by"),
    issuedByName: text("issued_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clinic_invoices_no_unique").on(t.invoiceNo),
    index("clinic_invoices_clinic_idx").on(t.clinicId),
    index("clinic_invoices_issued_idx").on(t.issuedAt),
    index("clinic_invoices_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Activity / audit log — CORE, platform-wide. Records staff actions (create /
 * update / delete / login / view) so a clinic admin can audit their clinic and
 * the super admin has the full platform trail. Actor identity is SNAPSHOTTED
 * (`actorName`/`actorRole`) so the row survives the user being renamed/deleted.
 *
 * Access is PERMISSION-based (not time-based): the super admin grants each
 * clinic a set of visible action categories via `clinics.log_access`; a clinic
 * admin sees only those categories for their own clinic. The super admin always
 * sees everything, across all clinics. See core/audit/access.ts.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which clinic the action belongs to (NULL for pure super-admin actions).
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "cascade",
    }),
    // Who did it — FK for joins, plus a snapshot that outlives the user.
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(), // create | update | delete | login | view | status
    entity: text("entity"), // patient | appointment | staff | clinic | settings | session | …
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(), // human-readable line
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Log views filter by clinic + date window (default today), newest first.
    index("activity_logs_clinic_created_idx").on(t.clinicId, t.createdAt),
    // Global (super-admin) date-window scan across clinics.
    index("activity_logs_created_idx").on(t.createdAt),
    index("activity_logs_actor_idx").on(t.actorUserId),
    // The view-dedupe lookup, which runs on EVERY record view (`logView`). Without
    // it Postgres walks `activity_logs_created_idx` over the whole dedupe window and
    // filters — so the cost of one user opening one patient scaled with PLATFORM-WIDE
    // activity in that window, not with their own. Partial, because `view` is the
    // only action deduped and the index has no reason to carry the rest.
    index("activity_logs_view_dedupe_idx")
      .on(t.actorUserId, t.entity, t.entityId, t.createdAt.desc())
      .where(sql`action = 'view'`),
  ],
);

/**
 * `announcements` — super-admin → clinic notices (Feature 10). `clinic_id` NULL =
 * broadcast to ALL clinics; else targeted to one. Shown in the clinic notice bar
 * while `active` and within the optional starts_at/ends_at window. Platform data
 * (super-admin's own content), not tenant clinical data — hard-deletable.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }), // NULL = all
    level: text("level").notNull().default("info"), // info | warning
    title: text("title").notNull(),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("announcements_clinic_idx").on(t.clinicId),
    index("announcements_active_idx").on(t.active),
  ],
);

export type ActivityLog = typeof activityLogs.$inferSelect;

export type ClinicPayment = typeof clinicPayments.$inferSelect;

export type PlatformCostRate = typeof platformCostRates.$inferSelect;

export type AiUsage = typeof aiUsage.$inferSelect;

export type CompanyExpense = typeof companyExpenses.$inferSelect;

export type CompanyExpenseCategory = typeof companyExpenseCategories.$inferSelect;

export type CompanySettings = typeof companySettings.$inferSelect;

export type ClinicInvoice = typeof clinicInvoices.$inferSelect;

export type Announcement = typeof announcements.$inferSelect;

export type ImportedTransaction = typeof importedTransactions.$inferSelect;
